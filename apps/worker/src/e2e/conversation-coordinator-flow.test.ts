import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { d1 } from "@me-builder/lib";
import type { ChatTurnQueueMessage } from "@me-builder/shared";
import Database from "better-sqlite3";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationCoordinator } from "../conversation-coordinator";
import type { Env } from "../types";

const migrationsDirectory = path.resolve(__dirname, "../../../../packages/lib/drizzle");

let miniflare: Miniflare;
let database: D1Database;

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
    CHAT_TURN_QUEUE: { send },
    GEMINI_MODEL: "test-model",
  } as unknown as Env;
  return { coordinator: new ConversationCoordinator(ctx, env), sql };
}

describe("ConversationCoordinator D1 recovery E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "conversation-coordinator-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await applyMigrations(database);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await miniflare.dispose();
  });

  it("D1反映後に停止しても固定batchだけを復旧し、後着messageを次Turnへ送る", async () => {
    const client = d1.client.create(database);
    const { account } = await d1.action.account.upsertIdentity(client, {
      provider: "line",
      providerAccountId: "U_coordinator_e2e",
    });
    const first = await d1.action.conversation.storeLineTextSource(client, {
      accountId: account.id,
      eventId: "event-1",
      body: "最初のメッセージ",
      receivedAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    const second = await d1.action.conversation.storeLineTextSource(client, {
      accountId: account.id,
      eventId: "event-2",
      body: "後から届いたメッセージ",
      receivedAt: new Date("2026-08-07T00:00:02.000Z"),
    });
    const queued: ChatTurnQueueMessage[] = [];
    const { coordinator, sql } = createCoordinator(async (message) => {
      queued.push(message);
    });

    await coordinator.acceptMessage({ ...first, receivedAt: first.receivedAt.toISOString() });
    sql.exec("UPDATE coordinator_state SET generation_epoch = 1 WHERE singleton = 1");
    sql.exec("UPDATE accepted_messages SET status = 'attaching' WHERE event_id = ?", first.eventId);
    sql.exec("INSERT INTO attach_batches(id, generation_epoch) VALUES ('batch-1', 1)");
    sql.exec(
      "INSERT INTO attach_batch_messages(event_id, batch_id) VALUES (?, 'batch-1')",
      first.eventId,
    );
    const firstTurn = await d1.action.conversation.attachMessagesToTurn(
      client,
      [first],
      1,
      "test-model",
    );
    await coordinator.acceptMessage({ ...second, receivedAt: second.receivedAt.toISOString() });

    await coordinator.alarm();
    await coordinator.alarm();
    await coordinator.alarm();

    expect(queued).toHaveLength(2);
    expect(queued[0]).toEqual({
      type: "chat-turn",
      turnId: firstTurn.turnId,
      generationEpoch: 1,
    });
    expect(queued[1]).toMatchObject({ type: "chat-turn", generationEpoch: 2 });
    const messages = await client
      .select({ channelEventId: d1.schema.conversationMessages.channelEventId })
      .from(d1.schema.conversationMessages)
      .orderBy(d1.schema.conversationMessages.sequence);
    expect(messages.map(({ channelEventId }) => channelEventId)).toEqual(["event-1", "event-2"]);
    expect(await client.select().from(d1.schema.chatTurns)).toHaveLength(2);
  });
});
