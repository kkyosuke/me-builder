import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { d1 } from "@me-builder/lib";
import { type ChatTurnQueueMessage, MAX_CHAT_TURN_TRACE_IDS } from "@me-builder/shared";
import Database from "better-sqlite3";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationCoordinator } from "../conversation-coordinator";
import { createD1AccountDataTestNamespace } from "../testing/account-data";
import type { Env } from "../types";

const migrationsDirectory = path.resolve(__dirname, "../../../../packages/lib/drizzle");
type StoredLineSource = Awaited<ReturnType<typeof d1.action.conversation.storeLineTextSource>>;
type StoredAccountLineSource = StoredLineSource & { accountId: string };

let miniflare: Miniflare;
let database: D1Database;
let client: d1.Client;

async function applyMigrations(db: D1Database): Promise<void> {
  const migrations = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrations) {
    const statements = (await readFile(path.join(migrationsDirectory, file), "utf8"))
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  }
}

function createCoordinator(send: (message: ChatTurnQueueMessage) => Promise<void>) {
  const sqlite = new Database(":memory:");
  const sql = {
    exec<T>(query: string, ...params: unknown[]) {
      if (query.includes("PRAGMA table_info")) {
        return { toArray: () => [] as T[], one: () => undefined as T };
      }
      if (query.includes("CREATE TABLE IF NOT EXISTS accepted_messages")) {
        sqlite.exec(query);
        return { toArray: () => [] as T[], one: () => undefined as T };
      }
      const statement = sqlite.prepare(query);
      const rows = statement.reader ? (statement.all(...params) as T[]) : [];
      const rawRows = statement.reader ? (statement.raw(true).all(...params) as unknown[][]) : [];
      if (!statement.reader) statement.run(...params);
      return {
        toArray: () => rows,
        raw: () => ({ toArray: () => rawRows }),
        one: () => {
          const row = rows[0];
          if (!row) throw new Error("Expected one row");
          return row;
        },
      };
    },
  };
  let alarm: number | null = null;
  const storage = {
    sql,
    transactionSync: (callback: () => void) => sqlite.transaction(callback)(),
    getAlarm: async () => alarm,
    setAlarm: async (value: number) => {
      alarm = value;
    },
  };
  const ctx = {
    storage,
    blockConcurrencyWhile: (callback: () => Promise<void>) => callback(),
  } as unknown as DurableObjectState;
  const env = {
    DB: database,
    ACCOUNT_DATA: createD1AccountDataTestNamespace(client),
    CHAT_TURN_QUEUE: { send },
    GEMINI_MODEL: "test-model",
  } as unknown as Env;
  const coordinator = new ConversationCoordinator(ctx, env);
  return {
    coordinator,
    getAlarm: () => alarm,
    runAlarm: async () => {
      alarm = null;
      await coordinator.alarm();
    },
    sql,
  };
}

async function storeSource(
  providerAccountId: string,
  eventId: string,
  body: string,
  receivedAt: Date,
): Promise<StoredAccountLineSource> {
  const { account } = await d1.action.account.upsertIdentity(client, {
    provider: "line",
    providerAccountId,
  });
  const source = await d1.action.conversation.storeLineTextSource(client, {
    accountId: account.id,
    eventId,
    body,
    receivedAt,
  });
  return { ...source, accountId: account.id };
}

function acceptedInput(source: StoredAccountLineSource) {
  return { ...source, receivedAt: source.receivedAt.toISOString() };
}

describe("ConversationCoordinator D1 E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "conversation-coordinator-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await applyMigrations(database);
    client = d1.client.create(database);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await miniflare.dispose();
  });

  it("連投を1つのTurnへまとめ、生成leaseの完了まで処理する", async () => {
    const first = await storeSource(
      "U_coalescing_e2e",
      "coalescing-event-1",
      "今日は少し疲れた",
      new Date("2026-08-07T00:00:00.000Z"),
    );
    const second = await storeSource(
      "U_coalescing_e2e",
      "coalescing-event-2",
      "それでも散歩できた",
      new Date("2026-08-07T00:00:01.000Z"),
    );
    const queued: ChatTurnQueueMessage[] = [];
    const { coordinator, runAlarm } = createCoordinator(async (message) => {
      queued.push(message);
    });

    await coordinator.acceptMessage({ ...acceptedInput(first), traceId: "trace-first" });
    await coordinator.acceptMessage({ ...acceptedInput(second), traceId: "trace-second" });
    await runAlarm();

    expect(queued).toHaveLength(1);
    const queuedTurn = queued[0];
    if (!queuedTurn) throw new Error("Expected a queued turn");
    expect(queuedTurn.traceId).toBe("trace-second");
    expect(queuedTurn.traceIds).toEqual(["trace-first", "trace-second"]);
    const context = await d1.action.conversation.getTurnContext(client, queuedTurn.turnId, 20);
    expect(context?.messages.map(({ body }) => body)).toEqual([
      "今日は少し疲れた",
      "それでも散歩できた",
    ]);
    const lease = await coordinator.acquireGeneration(
      queuedTurn.turnId,
      queuedTurn.generationEpoch,
    );
    expect(lease.acquired).toBe(true);
    if (!lease.acquired) throw new Error("Expected a generation lease");
    await expect(
      coordinator.completeGeneration(
        queuedTurn.turnId,
        queuedTurn.generationEpoch,
        lease.leaseToken,
      ),
    ).resolves.toBe(true);
    await expect(
      coordinator.acquireGeneration(queuedTurn.turnId, queuedTurn.generationEpoch),
    ).resolves.toEqual({ acquired: false, reason: "stale" });
  });

  it("1 TurnのtraceIdsを上限内に保ち、超過した入力を次Turnへ残す", async () => {
    const sourceCount = MAX_CHAT_TURN_TRACE_IDS + 1;
    const sources: StoredAccountLineSource[] = [];
    for (let index = 0; index < sourceCount; index += 1) {
      sources.push(
        await storeSource(
          "U_trace_limit_e2e",
          `trace-limit-event-${index}`,
          `message-${index}`,
          new Date(Date.UTC(2026, 7, 7, 0, 0, index)),
        ),
      );
    }
    const queued: ChatTurnQueueMessage[] = [];
    const { coordinator, getAlarm, runAlarm } = createCoordinator(async (message) => {
      queued.push(message);
    });
    for (const [index, source] of sources.entries()) {
      await coordinator.acceptMessage({ ...acceptedInput(source), traceId: `trace-${index}` });
    }

    await runAlarm();

    expect(queued).toHaveLength(1);
    expect(queued[0]?.traceIds).toEqual(
      Array.from({ length: MAX_CHAT_TURN_TRACE_IDS }, (_, index) => `trace-${index}`),
    );
    expect(queued[0]?.traceId).toBe(`trace-${MAX_CHAT_TURN_TRACE_IDS - 1}`);
    expect(getAlarm()).not.toBeNull();
    const context = await d1.action.conversation.getTurnContext(
      client,
      queued[0]?.turnId ?? "",
      sourceCount,
    );
    expect(context?.messages).toHaveLength(MAX_CHAT_TURN_TRACE_IDS);
  });

  it("D1反映後に停止しても固定batchだけを復旧し、後着messageを次Turnへ送る", async () => {
    const first = await storeSource(
      "U_recovery_e2e",
      "recovery-event-1",
      "最初のメッセージ",
      new Date("2026-08-07T00:00:00.000Z"),
    );
    const second = await storeSource(
      "U_recovery_e2e",
      "recovery-event-2",
      "後から届いたメッセージ",
      new Date("2026-08-07T00:00:02.000Z"),
    );
    const queued: ChatTurnQueueMessage[] = [];
    const { coordinator, runAlarm, sql } = createCoordinator(async (message) => {
      queued.push(message);
    });

    await coordinator.acceptMessage(acceptedInput(first));
    sql.exec("UPDATE coordinator_state SET generation_epoch = 1 WHERE singleton = 1");
    sql.exec("UPDATE accepted_messages SET status = 'attaching' WHERE event_id = ?", first.eventId);
    sql.exec("INSERT INTO attach_batches(id, generation_epoch) VALUES ('batch-1', 1)");
    sql.exec(
      "INSERT INTO attach_batch_messages(event_id, batch_id) VALUES (?, 'batch-1')",
      first.eventId,
    );
    const firstTurn = await d1.action.conversation.attachMessagesToTurn(
      client,
      first.accountId,
      [first],
      1,
      "test-model",
      "test-prompt",
    );
    await coordinator.acceptMessage(acceptedInput(second));

    await runAlarm();
    await runAlarm();
    await runAlarm();

    expect(queued).toHaveLength(2);
    expect(queued[0]).toEqual({
      type: "chat-turn",
      accountId: first.accountId,
      turnId: firstTurn.turnId,
      generationEpoch: 1,
    });
    expect(queued[1]).toMatchObject({ type: "chat-turn", generationEpoch: 2 });
    const messages = await client
      .select({ channelEventId: d1.schema.conversationMessages.channelEventId })
      .from(d1.schema.conversationMessages)
      .orderBy(d1.schema.conversationMessages.sequence);
    expect(messages.map(({ channelEventId }) => channelEventId)).toEqual([
      "recovery-event-1",
      "recovery-event-2",
    ]);
    expect(await client.select().from(d1.schema.chatTurns)).toHaveLength(2);
  });

  it("Queue投入が一時失敗してもalarmから同じTurnだけを再投入する", async () => {
    const source = await storeSource(
      "U_queue_retry_e2e",
      "queue-retry-event",
      "あとで返信してほしい",
      new Date("2026-08-07T00:00:00.000Z"),
    );
    const queued: ChatTurnQueueMessage[] = [];
    let attempt = 0;
    const { coordinator, getAlarm, runAlarm } = createCoordinator(async (message) => {
      attempt += 1;
      if (attempt === 1) throw new Error("temporary queue outage");
      queued.push(message);
    });
    await coordinator.acceptMessage(acceptedInput(source));

    const beforeFailure = Date.now();
    await runAlarm();
    expect(getAlarm()).toBeGreaterThanOrEqual(beforeFailure + 30_000);
    await runAlarm();

    expect(attempt).toBe(2);
    expect(queued).toHaveLength(1);
    expect(await client.select().from(d1.schema.chatTurns)).toHaveLength(1);
    expect(await client.select().from(d1.schema.conversationMessages)).toHaveLength(1);
  });

  it("保持期間後に再送されたeventから既存Turnを再生成しない", async () => {
    const source = await storeSource(
      "U_old_event_e2e",
      "old-event",
      "古いメッセージ",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const queued: ChatTurnQueueMessage[] = [];
    const { coordinator, runAlarm, sql } = createCoordinator(async (message) => {
      queued.push(message);
    });
    await coordinator.acceptMessage(acceptedInput(source));
    await runAlarm();
    await runAlarm();
    expect(
      sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM accepted_messages").one().count,
    ).toBe(0);

    await expect(coordinator.acceptMessage(acceptedInput(source))).resolves.toEqual({
      accepted: true,
    });
    await runAlarm();

    expect(queued).toHaveLength(1);
    expect(await client.select().from(d1.schema.chatTurns)).toHaveLength(1);
    expect(await client.select().from(d1.schema.conversationMessages)).toHaveLength(1);
  });

  it("保持期間後の古いeventと新着eventが混在しても新着だけを次Turnへ送る", async () => {
    const oldSource = await storeSource(
      "U_mixed_replay_e2e",
      "mixed-old-event",
      "保存済みの古いメッセージ",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const freshSource = await storeSource(
      "U_mixed_replay_e2e",
      "mixed-fresh-event",
      "本当の新着メッセージ",
      new Date("2026-08-07T00:00:02.000Z"),
    );
    const queued: ChatTurnQueueMessage[] = [];
    const { coordinator, runAlarm } = createCoordinator(async (message) => {
      queued.push(message);
    });
    await coordinator.acceptMessage(acceptedInput(oldSource));
    await runAlarm();
    await runAlarm();

    await coordinator.acceptMessage(acceptedInput(oldSource));
    await coordinator.acceptMessage(acceptedInput(freshSource));
    await runAlarm();

    expect(queued).toHaveLength(2);
    expect(await client.select().from(d1.schema.chatTurns)).toHaveLength(2);
    const messages = await client
      .select({ channelEventId: d1.schema.conversationMessages.channelEventId })
      .from(d1.schema.conversationMessages)
      .orderBy(d1.schema.conversationMessages.sequence);
    expect(messages.map(({ channelEventId }) => channelEventId)).toEqual([
      "mixed-old-event",
      "mixed-fresh-event",
    ]);
  });

  it("異なるAccountのmessageを同じCoordinatorへ混入させない", async () => {
    const first = await storeSource(
      "U_account_a_e2e",
      "account-a-event",
      "Account Aのメッセージ",
      new Date("2026-08-07T00:00:00.000Z"),
    );
    const second = await storeSource(
      "U_account_b_e2e",
      "account-b-event",
      "Account Bのメッセージ",
      new Date("2026-08-07T00:00:01.000Z"),
    );
    const queued: ChatTurnQueueMessage[] = [];
    const { coordinator, runAlarm } = createCoordinator(async (message) => {
      queued.push(message);
    });

    await coordinator.acceptMessage(acceptedInput(first));
    await expect(coordinator.acceptMessage(acceptedInput(second))).rejects.toThrow(
      "another account",
    );
    await runAlarm();

    expect(queued).toHaveLength(1);
    const messages = await client.select().from(d1.schema.conversationMessages);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.channelEventId).toBe("account-a-event");
  });

  it("同じeventのWebhook再配送を1回だけD1とQueueへ反映する", async () => {
    const source = await storeSource(
      "U_duplicate_e2e",
      "duplicate-event",
      "重複してはいけないメッセージ",
      new Date("2026-08-07T00:00:00.000Z"),
    );
    const queued: ChatTurnQueueMessage[] = [];
    const { coordinator, runAlarm } = createCoordinator(async (message) => {
      queued.push(message);
    });

    await expect(coordinator.acceptMessage(acceptedInput(source))).resolves.toEqual({
      accepted: true,
    });
    await expect(coordinator.acceptMessage(acceptedInput(source))).resolves.toEqual({
      accepted: false,
    });
    await runAlarm();
    await runAlarm();

    expect(queued).toHaveLength(1);
    expect(await client.select().from(d1.schema.chatTurns)).toHaveLength(1);
    expect(await client.select().from(d1.schema.conversationMessages)).toHaveLength(1);
  });

  it("生成leaseのalarmより新着messageの連投待ちを優先する", async () => {
    const first = await storeSource(
      "U_alarm_priority_e2e",
      "alarm-priority-event-1",
      "最初のメッセージ",
      new Date("2026-08-07T00:00:00.000Z"),
    );
    const second = await storeSource(
      "U_alarm_priority_e2e",
      "alarm-priority-event-2",
      "生成中に届いたメッセージ",
      new Date("2026-08-07T00:00:02.000Z"),
    );
    const queued: ChatTurnQueueMessage[] = [];
    const { coordinator, getAlarm, runAlarm } = createCoordinator(async (message) => {
      queued.push(message);
    });
    await coordinator.acceptMessage(acceptedInput(first));
    await runAlarm();
    const firstTurn = queued[0];
    if (!firstTurn) throw new Error("Expected the first queued turn");
    const lease = await coordinator.acquireGeneration(firstTurn.turnId, firstTurn.generationEpoch);
    if (!lease.acquired) throw new Error("Expected a generation lease");

    await coordinator.acceptMessage(acceptedInput(second));

    const nextAlarm = getAlarm();
    expect(nextAlarm).not.toBeNull();
    expect(nextAlarm).toBeLessThan(lease.hardDeadlineAt);
    expect(nextAlarm).toBeLessThanOrEqual(Date.now() + 1_500);
    await runAlarm();
    expect(queued).toHaveLength(2);
    expect(await client.select().from(d1.schema.chatTurns)).toHaveLength(2);
  });
});
