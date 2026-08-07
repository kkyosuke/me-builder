import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { d1, line } from "@me-builder/lib";
import type { ChatTurnQueueMessage, Message } from "@me-builder/shared";
import Database from "better-sqlite3";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "../config";
import type { CloudflareBindings } from "../config";
import { ConversationCoordinator } from "../conversation-coordinator";
import { processChatTurnMessage } from "../handler/chat-turn";
import { processLineWebhook } from "../logic/feature/line";
import type { Env } from "../types";

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

const migrationsDirectory = path.resolve(__dirname, "../../../../packages/lib/drizzle");
const generatedReply = "散歩できたことが、少し心に残っているんだね。どんな景色だった？";
const workerConfig = getWorkerConfig({
  ENVIRONMENT: "test",
  LINE_CHANNEL_ACCESS_TOKEN: "line-token",
  CHAT_DELIVERY_SECRET: "delivery-secret",
  GOOGLE_AI_STUDIO_API_KEY: "google-key",
  CLOUDFLARE_AIG_TOKEN: "gateway-token",
  CHAT_CONTEXT_MESSAGE_LIMIT: "20",
});

let miniflare: Miniflare;
let database: D1Database;
let client: d1.Client;
let mockPushMessage: ReturnType<typeof vi.fn>;

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
  let initialization = Promise.resolve();
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
    blockConcurrencyWhile: (callback: () => Promise<void>) => {
      initialization = callback();
      return initialization;
    },
  } as unknown as DurableObjectState;
  const env = {
    DB: database,
    CHAT_TURN_QUEUE: { send },
    GEMINI_MODEL: "test-model",
    LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    CHAT_DELIVERY_SECRET: "delivery-secret",
  } as unknown as Env;
  const coordinator = new ConversationCoordinator(ctx, env);
  return {
    coordinator,
    ready: () => initialization,
    runAlarm: async () => {
      alarm = null;
      await coordinator.alarm();
    },
  };
}

function createQueueMessage(
  body: ChatTurnQueueMessage,
  attempts = 1,
): Message<ChatTurnQueueMessage> {
  return {
    id: `queue-${body.turnId}`,
    timestamp: new Date("2026-08-07T00:00:02.000Z"),
    attempts,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

async function ingestDiary(text: string, suffix: string) {
  const queued: ChatTurnQueueMessage[] = [];
  const harness = createCoordinator(async (message) => {
    queued.push(message);
  });
  await harness.ready();
  const namespace = {
    getByName: vi.fn(() => harness.coordinator),
  } as unknown as NonNullable<Env["CONVERSATION_COORDINATOR"]>;
  const providerAccountId = `U_diary_delivery_${suffix}`;
  const eventId = `diary-delivery-event-${suffix}`;
  const receivedAt = new Date(Date.now() - 2_000).toISOString();

  await processLineWebhook(
    {
      events: [
        {
          type: "message",
          webhookEventId: eventId,
          timestamp: new Date(receivedAt).getTime(),
          message: { type: "text", id: `line-message-${suffix}`, text },
          source: { type: "user", userId: providerAccountId },
        },
      ],
    },
    client,
    workerConfig,
    namespace,
  );
  const resolved = await d1.action.account.upsertIdentity(client, {
    provider: "line",
    providerAccountId,
  });
  await harness.coordinator.reserveReceipt({
    accountId: resolved.account.id,
    eventId,
    receivedAt,
  });
  await harness.runAlarm();

  expect(queued).toHaveLength(1);
  const queuedTurn = queued[0];
  if (!queuedTurn) throw new Error("Expected a queued chat turn");
  const bindings: CloudflareBindings = {
    d1: client,
    do: { conversation: namespace },
    queue: { chatTurn: undefined },
  };
  return { bindings, coordinator: harness.coordinator, providerAccountId, queuedTurn };
}

describe("LINE diary chat delivery E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "diary-chat-delivery-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await applyMigrations(database);
    client = d1.client.create(database);
    mockGenerateContent.mockReset().mockResolvedValue({
      text: JSON.stringify({
        mode: "explore",
        reply: generatedReply,
        main_question_count: 1,
        end_session: false,
        safety: { route: "normal", restricted_advice: false },
      }),
    });
    mockPushMessage = vi.fn().mockResolvedValue({});
    vi.spyOn(line.client, "create").mockReturnValue({
      pushMessage: mockPushMessage,
    } as unknown as ReturnType<typeof line.client.create>);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await miniflare.dispose();
  });

  it("原本保存から生成、assistant保存、LINE final配送、Turn完了まで通す", async () => {
    const diaryText = "今日は公園を散歩できた";
    const { bindings, coordinator, providerAccountId, queuedTurn } = await ingestDiary(
      diaryText,
      "success",
    );
    const message = createQueueMessage(queuedTurn);

    await processChatTurnMessage(message, bindings, workerConfig);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(JSON.stringify(queuedTurn)).not.toContain(diaryText);
    expect(JSON.stringify(queuedTurn)).not.toContain(providerAccountId);
    expect(mockGenerateContent).toHaveBeenCalledOnce();
    const prompt = mockGenerateContent.mock.calls[0]?.[0]?.contents;
    expect(JSON.parse(prompt).context_package.messages).toEqual([
      expect.objectContaining({ role: "user", body: diaryText }),
    ]);

    const turns = await client.select().from(d1.schema.chatTurns);
    expect(turns).toEqual([
      expect.objectContaining({
        id: queuedTurn.turnId,
        status: "delivered",
        attemptCount: 1,
      }),
    ]);
    const messages = await client.select().from(d1.schema.conversationMessages);
    expect(messages).toEqual([
      expect.objectContaining({ role: "user", assistantBody: null }),
      expect.objectContaining({ role: "assistant", assistantBody: generatedReply }),
    ]);
    expect(mockPushMessage).toHaveBeenCalledTimes(2);
    expect(mockPushMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        to: providerAccountId,
        messages: [expect.objectContaining({ text: expect.stringContaining("受け付けました") })],
      }),
    );
    expect(mockPushMessage.mock.calls[1]?.[0]).toEqual({
      to: providerAccountId,
      messages: [{ type: "text", text: generatedReply }],
    });
    expect(mockPushMessage.mock.calls[0]?.[1]).not.toBe(mockPushMessage.mock.calls[1]?.[1]);
    await expect(
      coordinator.acquireGeneration(queuedTurn.turnId, queuedTurn.generationEpoch),
    ).resolves.toEqual({ acquired: false, reason: "stale" });
  });

  it("LINEが同じretry keyを409で拒否しても配送済みとして完了する", async () => {
    const { bindings, queuedTurn } = await ingestDiary("今日は本を読めた", "retry-conflict");
    mockPushMessage.mockRejectedValueOnce({ status: 409 });
    const message = createQueueMessage(queuedTurn);

    await processChatTurnMessage(message, bindings, workerConfig);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    await expect(client.select().from(d1.schema.chatTurns)).resolves.toEqual([
      expect.objectContaining({ status: "delivered" }),
    ]);
  });

  it("生成完了時にleaseが失効していればassistant応答を保存も配送もしない", async () => {
    const { bindings, coordinator, queuedTurn } = await ingestDiary(
      "今日は長く考えていた",
      "expired-lease",
    );
    vi.spyOn(coordinator, "isGenerationLeaseActive").mockResolvedValue(false);
    const message = createQueueMessage(queuedTurn);

    await expect(processChatTurnMessage(message, bindings, workerConfig)).rejects.toThrow(
      "Generation lease expired before response persistence",
    );

    const messages = await client.select().from(d1.schema.conversationMessages);
    expect(messages).toEqual([expect.objectContaining({ role: "user", assistantBody: null })]);
    expect(mockPushMessage).toHaveBeenCalledTimes(1);
  });

  it("生成中にSessionが閉じていれば生成も最終配送も行わない", async () => {
    const { bindings, queuedTurn } = await ingestDiary("今日は区切りをつけたい", "closed-session");
    await client
      .update(d1.schema.conversationSessions)
      .set({ status: "closed", closedAt: new Date(), closeReason: "inactive" });
    const message = createQueueMessage(queuedTurn);

    await processChatTurnMessage(message, bindings, workerConfig);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(mockPushMessage).toHaveBeenCalledTimes(1);
    await expect(client.select().from(d1.schema.chatTurns)).resolves.toEqual([
      expect.objectContaining({ status: "failed", failureStage: "closed_session" }),
    ]);
  });

  it("最終attemptの生成失敗では固定retry keyの失敗案内を配送してTurnをfailedにする", async () => {
    const { bindings, coordinator, queuedTurn } = await ingestDiary(
      "今日はうまく話せない",
      "failure",
    );
    mockGenerateContent.mockRejectedValue(new Error("provider unavailable"));
    const message = createQueueMessage(queuedTurn, 2);

    await processChatTurnMessage(message, bindings, workerConfig);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    await expect(client.select().from(d1.schema.chatTurns)).resolves.toEqual([
      expect.objectContaining({ status: "failed", failureStage: "generation_or_delivery" }),
    ]);
    expect(mockPushMessage.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        messages: [
          expect.objectContaining({ text: expect.stringContaining("返事をまとめられません") }),
        ],
      }),
    );
    await expect(
      coordinator.deliverTurn({
        turnId: queuedTurn.turnId,
        generationEpoch: queuedTurn.generationEpoch,
        leaseToken: "obsolete-token",
        kind: "final",
        text: generatedReply,
      }),
    ).resolves.toEqual({ status: "superseded" });
    expect(mockPushMessage).toHaveBeenCalledTimes(2);
  });

  it("失敗案内の一時障害後はAIを再生成せず同じoutboxだけを再配送する", async () => {
    const { bindings, queuedTurn } = await ingestDiary(
      "今日は言葉が出てこない",
      "failure-transient",
    );
    mockGenerateContent.mockRejectedValue(new Error("provider unavailable"));
    mockPushMessage.mockRejectedValueOnce({ status: 503 }).mockResolvedValue({});
    const first = createQueueMessage(queuedTurn, 2);

    await expect(processChatTurnMessage(first, bindings, workerConfig)).rejects.toThrow(
      "provider unavailable",
    );
    const retry = createQueueMessage(queuedTurn, 3);
    await processChatTurnMessage(retry, bindings, workerConfig);

    expect(mockGenerateContent).toHaveBeenCalledOnce();
    expect(retry.ack).toHaveBeenCalledOnce();
    const failureCalls = mockPushMessage.mock.calls.slice(1);
    expect(failureCalls).toHaveLength(2);
    expect(failureCalls[0]?.[0]).toEqual(failureCalls[1]?.[0]);
    expect(failureCalls[0]?.[1]).toBe(failureCalls[1]?.[1]);
  });

  it("LINEの一時障害後も永続化済みoutboxの同じ本文とretry keyだけで再送する", async () => {
    const { bindings, coordinator, queuedTurn } = await ingestDiary(
      "今日は雨だった",
      "transient-retry",
    );
    const deliverTurn = vi.spyOn(coordinator, "deliverTurn");
    mockPushMessage.mockRejectedValueOnce({ status: 503 }).mockResolvedValue({});
    const first = createQueueMessage(queuedTurn, 1);

    await expect(processChatTurnMessage(first, bindings, workerConfig)).rejects.toEqual({
      status: 503,
    });
    const firstDelivery = deliverTurn.mock.calls[0]?.[0];
    if (!firstDelivery) throw new Error("Expected the first delivery reservation");
    await expect(coordinator.deliverTurn(firstDelivery)).resolves.toEqual({
      status: "lease_expired",
    });
    expect(mockPushMessage).toHaveBeenCalledTimes(2);
    const retry = createQueueMessage(queuedTurn, 2);
    await processChatTurnMessage(retry, bindings, workerConfig);

    expect(retry.ack).toHaveBeenCalledOnce();
    const finalCalls = mockPushMessage.mock.calls.slice(1);
    expect(finalCalls).toHaveLength(2);
    expect(finalCalls[0]?.[0]).toEqual(finalCalls[1]?.[0]);
    expect(finalCalls[0]?.[1]).toBe(finalCalls[1]?.[1]);
  });
});
