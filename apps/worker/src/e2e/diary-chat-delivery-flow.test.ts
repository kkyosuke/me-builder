import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import {
  D1,
  DO,
  billing,
  buildDiaryTemporalSearchText,
  line,
  resolveDiaryTemporalContext,
} from "@me-builder/lib";
import {
  type ChatTurnQueueMessage,
  type Message,
  type MessageBatch,
  type WebhookQueueMessage,
  logger,
} from "@me-builder/shared";
import Database from "better-sqlite3";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "../config";
import type { CloudflareBindings } from "../config";
import { ConversationCoordinator } from "../conversation-coordinator";
import { processChatTurnMessage } from "../handler/chat-turn";
import { queueHandler } from "../handler/queue";
import { type AccountDataTestStore, createAccountDataTestStore } from "../testing/account-data";
import type { Env } from "../types";

const { mockEmbedContent, mockGenerateContent } = vi.hoisted(() => ({
  mockEmbedContent: vi.fn(),
  mockGenerateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { embedContent: mockEmbedContent, generateContent: mockGenerateContent };
  },
}));

const migrationsDirectory = path.resolve(__dirname, "../../../../packages/lib/drizzle");
const generatedReply = "散歩できたことが、少し心に残っているんだね。どんな景色だった？";
const liffId = "1234567890-diary-test";
const workerConfig = getWorkerConfig({
  ENVIRONMENT: "test",
  LINE_CHANNEL_ACCESS_TOKEN: "line-token",
  CHAT_DELIVERY_SECRET: "delivery-secret",
  GOOGLE_VERTEX_AI_API_KEY: "google-key",
  CHAT_CONTEXT_MESSAGE_LIMIT: "20",
  LIFF_ID: liffId,
});

let miniflare: Miniflare;
let database: D1Database;
let client: D1.shared.Client;
let accountDataStore: AccountDataTestStore;
let mockPushMessage: ReturnType<typeof vi.fn>;
let mockReplyMessage: ReturnType<typeof vi.fn>;

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
    ACCOUNT_DATA: accountDataStore.namespace,
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

async function turnStatus(turnId: string): Promise<string | undefined> {
  const turns = await accountDataStore.db.select().from(DO.account.schema.chatTurns);
  return turns.find((turn) => turn.id === turnId)?.status;
}

async function exhaustFreeAiReplyUsage(accountId: string): Promise<void> {
  const at = new Date();
  const entitlement = await new billing.EntitlementService(
    new billing.FakeAccountPlanAssignmentProvider(),
  ).resolve(accountId, at);
  const period = billing.resolveEntitlementUsagePeriod(entitlement, "ai-reply", at);
  for (let index = 0; index < entitlement.policy.aiReply.limit; index += 1) {
    const requestId = `exhausted-ai-reply-${index}`;
    await DO.account.action.aiUsage.reserveAiUsage(
      accountDataStore.db,
      accountId,
      { requestId, kind: "ai-reply", period, limit: entitlement.policy.aiReply.limit },
      at,
    );
    await DO.account.action.aiUsage.commitAiUsage(accountDataStore.db, accountId, requestId, at);
  }
}

type DiaryEventInput = {
  text: string;
  replyToken?: string;
  /** replyTokenの有効期限はここを基準に決まるので、期限切れの検証はこの値をずらす。 */
  receivedAgoMs?: number;
};

async function enqueueLineEvents(
  events: unknown[],
  namespace: NonNullable<Env["CONVERSATION_COORDINATOR"]>,
  accountData: NonNullable<Env["ACCOUNT_DATA"]>,
): Promise<string> {
  const payload = { events };
  const traceId = crypto.randomUUID();
  const message: Message<WebhookQueueMessage> = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    attempts: 1,
    body: {
      id: crypto.randomUUID(),
      traceId,
      source: "line",
      receivedAt: new Date().toISOString(),
      payload,
      routing: {
        lineTextEvents: events.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const event = value as {
            webhookEventId?: string;
            message?: { type?: string; id?: string; text?: string };
          };
          if (event.message?.type !== "text" || !event.message.text) return [];
          const eventId = event.webhookEventId ?? event.message.id;
          return eventId ? [{ eventId, intent: line.text.classify(event.message.text) }] : [];
        }),
      },
    },
    ack: vi.fn(),
    retry: vi.fn(),
  };
  const batch: MessageBatch<WebhookQueueMessage | ChatTurnQueueMessage> = {
    queue: "me-builder-webhook-queue-e2e",
    messages: [message],
    metadata: {
      metrics: { backlogCount: 1, backlogBytes: 0 },
    },
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };

  await queueHandler(batch, {
    DB: database,
    CONVERSATION_COORDINATOR: namespace,
    ACCOUNT_DATA: accountData,
    ENVIRONMENT: "test",
    LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    CHAT_DELIVERY_SECRET: "delivery-secret",
    GOOGLE_VERTEX_AI_API_KEY: "google-key",
    CHAT_CONTEXT_MESSAGE_LIMIT: "20",
    LIFF_ID: liffId,
  });

  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
  return traceId;
}

async function acceptCurrentTermsFor(providerAccountId: string): Promise<void> {
  const resolved = await D1.shared.action.account.resolveAccountByLineMessagingApi(
    client,
    providerAccountId,
  );
  await D1.shared.action.agreement.acceptCurrentTerms(client, resolved.account.id);
}

async function ingestDiaryEvents(events: DiaryEventInput[], suffix: string) {
  const queued: ChatTurnQueueMessage[] = [];
  const harness = createCoordinator(async (message) => {
    queued.push(message);
  });
  await harness.ready();
  const namespace = {
    getByName: vi.fn(() => harness.coordinator),
  } as unknown as NonNullable<Env["CONVERSATION_COORDINATOR"]>;
  const providerAccountId = `U_diary_delivery_${suffix}`;
  const accountData = accountDataStore.namespace;
  await acceptCurrentTermsFor(providerAccountId);

  const traceId = await enqueueLineEvents(
    events.map((event, index) => ({
      type: "message",
      webhookEventId: `diary-delivery-event-${suffix}-${index}`,
      timestamp: Date.now() - (event.receivedAgoMs ?? 2_000),
      message: { type: "text", id: `line-message-${suffix}-${index}`, text: event.text },
      source: { type: "user", userId: providerAccountId },
      ...(event.replyToken ? { replyToken: event.replyToken } : {}),
    })),
    namespace,
    accountData,
  );
  await harness.runAlarm();

  expect(queued).toHaveLength(1);
  const queuedTurn = queued[0];
  if (!queuedTurn) throw new Error("Expected a queued chat turn");
  const bindings: CloudflareBindings = {
    d1: client,
    do: { conversation: namespace, accountData },
    queue: { chatTurn: undefined, brainCheckpoint: undefined },
  };
  return {
    bindings,
    coordinator: harness.coordinator,
    harness,
    providerAccountId,
    queuedTurn,
    traceId,
  };
}

async function ingestDiary(text: string, suffix: string, replyToken?: string) {
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
  const accountData = accountDataStore.namespace;
  await acceptCurrentTermsFor(providerAccountId);

  const traceId = await enqueueLineEvents(
    [
      {
        type: "message",
        webhookEventId: eventId,
        timestamp: new Date(receivedAt).getTime(),
        message: { type: "text", id: `line-message-${suffix}`, text },
        source: { type: "user", userId: providerAccountId },
        ...(replyToken ? { replyToken } : {}),
      },
    ],
    namespace,
    accountData,
  );
  await harness.runAlarm();

  expect(queued).toHaveLength(1);
  const queuedTurn = queued[0];
  if (!queuedTurn) throw new Error("Expected a queued chat turn");
  const bindings: CloudflareBindings = {
    d1: client,
    do: { conversation: namespace, accountData },
    queue: { chatTurn: undefined, brainCheckpoint: undefined },
  };
  return { bindings, coordinator: harness.coordinator, providerAccountId, queuedTurn, traceId };
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
    client = D1.shared.client.create(database);
    accountDataStore = createAccountDataTestStore();
    mockEmbedContent.mockReset().mockResolvedValue({
      embeddings: [{ values: Array.from({ length: 768 }, () => 0.1) }],
    });
    mockGenerateContent.mockReset().mockResolvedValue({
      text: JSON.stringify({
        mode: "explore",
        reply: generatedReply,
        main_question_count: 1,
        end_session: false,
        daily_prompt_follow_up: "none",
        collection_theme_id: "none",
        collection_kind: "none",
        safety: { route: "normal", restricted_advice: false },
        used_memory_ids: [],
      }),
    });
    mockPushMessage = vi.fn().mockResolvedValue({});
    mockReplyMessage = vi.fn().mockResolvedValue({});
    vi.spyOn(line.client, "create").mockReturnValue({
      pushMessage: mockPushMessage,
      replyMessage: mockReplyMessage,
    } as unknown as ReturnType<typeof line.client.create>);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await miniflare.dispose();
  });

  it("原本保存から生成、assistant保存、LINE final配送、Turn完了まで通す", async () => {
    const diaryText = "今日は公園を散歩できた";
    const { bindings, coordinator, providerAccountId, queuedTurn, traceId } = await ingestDiary(
      diaryText,
      "success",
    );
    const message = createQueueMessage(queuedTurn);
    const infoLog = vi.spyOn(logger, "info");

    await processChatTurnMessage(message, bindings, workerConfig);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(queuedTurn.traceId).toBe(traceId);
    expect(queuedTurn.traceIds).toEqual([traceId]);
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "queue.message.completed",
        component: "chat-turn",
        traceId,
        traceIds: [traceId],
        outcome: "succeeded",
        disposition: "ack",
        stage: "line.deliver",
      }),
      expect.stringContaining("[Chat turn] succeeded at line.deliver -> ack"),
    );
    expect(JSON.stringify(queuedTurn)).not.toContain(diaryText);
    expect(JSON.stringify(queuedTurn)).not.toContain(providerAccountId);
    expect(mockGenerateContent).toHaveBeenCalledOnce();
    const prompt = mockGenerateContent.mock.calls[0]?.[0]?.contents;
    expect(JSON.parse(prompt).context_package.messages).toEqual([
      expect.objectContaining({ role: "user", body: diaryText }),
    ]);

    const turns = await accountDataStore.db.select().from(DO.account.schema.chatTurns);
    expect(turns).toEqual([
      expect.objectContaining({
        id: queuedTurn.turnId,
        status: "delivered",
        attemptCount: 1,
      }),
    ]);
    const messages = await accountDataStore.db
      .select()
      .from(DO.account.schema.conversationMessages);
    expect(messages).toEqual([
      expect.objectContaining({ role: "user", assistantBody: null }),
      expect.objectContaining({ role: "assistant", assistantBody: generatedReply }),
    ]);
    expect(await accountDataStore.db.select().from(DO.account.schema.brainItems)).toEqual([]);
    expect(
      await accountDataStore.db.select().from(DO.account.schema.diaryBrainCheckpoints),
    ).toEqual([
      expect.objectContaining({ status: "pending", fromSequence: 1, throughSequence: 1 }),
    ]);
    expect(mockPushMessage).toHaveBeenCalledOnce();
    expect(mockPushMessage.mock.calls[0]?.[0]).toEqual({
      to: providerAccountId,
      messages: [
        {
          type: "text",
          text: generatedReply,
        },
      ],
    });
    await expect(
      coordinator.acquireGeneration(queuedTurn.turnId, queuedTurn.generationEpoch),
    ).resolves.toEqual({ acquired: false, reason: "stale" });
  });

  it("Free上限到達時はURLやQueue直実行でもAIを呼ばず、入力保存と固定案内を維持する", async () => {
    const diaryText = "今日は公園を歩いた";
    const { bindings, queuedTurn } = await ingestDiary(diaryText, "free-limit");
    await exhaustFreeAiReplyUsage(queuedTurn.accountId);

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(mockPushMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ text: expect.stringContaining("AI返信上限") })],
      }),
      expect.any(String),
    );
    const sources = await accountDataStore.db
      .select()
      .from(DO.account.schema.sourceRecordTextPayloads);
    expect(sources.some(({ body }) => body === diaryText)).toBe(true);
  });

  it("Freeの関係性質問は現在の発言だけをContextにし、相手と区分を1問で確認する", async () => {
    const { bindings, queuedTurn } = await ingestDiary(
      "あの人と揉めてしまって、どう話せばいいか迷っている",
      "relationship-free",
    );

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    const prompt = JSON.parse(mockGenerateContent.mock.calls[0]?.[0]?.contents).context_package;
    expect(prompt.messages).toEqual([
      expect.objectContaining({
        role: "user",
        body: "あの人と揉めてしまって、どう話せばいいか迷っている",
      }),
    ]);
    expect(prompt.memories).toEqual([]);
    expect(prompt.relationship_question).toEqual({
      context_scope: "current-message",
      person_reference_status: "needs-confirmation",
      relationship_category: "unconfirmed",
      own_diagnoses: [],
    });
    expect(mockGenerateContent.mock.calls[0]?.[0]?.config?.systemInstruction).toContain(
      "その相手はどんな関係の方？",
    );
  });

  it("Liteの関係性質問は現在Sessionと本人の関連診断だけをContextにする", async () => {
    const { bindings, queuedTurn } = await ingestDiary(
      "職場の同僚と意見がぶつかった",
      "relationship-lite",
    );
    const at = new Date("2026-08-15T00:00:00Z");
    await accountDataStore.db.insert(DO.account.schema.diagnosisScoringConfigs).values({
      id: "relationship-lite-scoring",
      version: 1,
      definition: {},
    });
    await accountDataStore.db.insert(DO.account.schema.diagnoses).values([
      {
        id: "work-relationship-style",
        title: "仕事の関係性",
        relationshipCategory: "work",
        scoringConfigId: "relationship-lite-scoring",
        opensAt: at,
        state: "published",
      },
      {
        id: "partner-relationship-style",
        title: "パートナーとの関係性",
        relationshipCategory: "partner",
        scoringConfigId: "relationship-lite-scoring",
        opensAt: at,
        state: "published",
      },
    ]);
    await accountDataStore.db.insert(DO.account.schema.brainItems).values([
      {
        id: "work-relationship-brain",
        accountId: queuedTurn.accountId,
        category: "preference",
        statement: "考えを整理してから伝える傾向がある",
        attributes: {},
        derivation: "deterministic",
        status: "active",
        stability: "changeable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: {},
      },
      {
        id: "partner-relationship-brain",
        accountId: queuedTurn.accountId,
        category: "preference",
        statement: "パートナーには早めの相談を好む傾向がある",
        attributes: {},
        derivation: "deterministic",
        status: "active",
        stability: "changeable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: {},
      },
    ]);
    await accountDataStore.db.insert(DO.account.schema.diagnosisBrainProjectionHeads).values([
      {
        id: "work-relationship-head",
        accountId: queuedTurn.accountId,
        diagnosisId: "work-relationship-style",
        scoringConfigId: "relationship-lite-scoring",
        scoringConfigVersion: 1,
        parameterId: "communication",
        currentBrainItemId: "work-relationship-brain",
        contentSignature: "work",
      },
      {
        id: "partner-relationship-head",
        accountId: queuedTurn.accountId,
        diagnosisId: "partner-relationship-style",
        scoringConfigId: "relationship-lite-scoring",
        scoringConfigVersion: 1,
        parameterId: "communication",
        currentBrainItemId: "partner-relationship-brain",
        contentSignature: "partner",
      },
    ]);
    bindings.planAssignmentProvider = new billing.FakeAccountPlanAssignmentProvider([
      {
        accountId: queuedTurn.accountId,
        plan: "lite",
        source: "subscription",
        effectiveAt: new Date(0).toISOString(),
        availableUntil: null,
        payerAccountId: queuedTurn.accountId,
      },
    ]);

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    const prompt = JSON.parse(mockGenerateContent.mock.calls[0]?.[0]?.contents).context_package;
    expect(prompt.relationship_question).toMatchObject({
      context_scope: "session-and-diagnosis",
      person_reference_status: "confirmed",
      relationship_category: "work",
      own_diagnoses: [
        {
          diagnosis_id: "work-relationship-style",
          relationship_category: "work",
          statement: "考えを整理してから伝える傾向がある",
        },
      ],
    });
    expect(JSON.stringify(prompt)).not.toContain("partner-relationship-style");
  });

  it("Free上限到達後も切迫した危機表現は利用枠を使わず安全案内へ切り替える", async () => {
    const { bindings, queuedTurn } = await ingestDiary("今すぐ死ぬ準備をしている", "safety-limit");
    await exhaustFreeAiReplyUsage(queuedTurn.accountId);

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    expect(mockGenerateContent).not.toHaveBeenCalled();
    const deliveredText = mockPushMessage.mock.calls[0]?.[0]?.messages?.[0]?.text;
    expect(deliveredText).toContain("緊急窓口");
    expect(deliveredText).not.toContain("AI返信上限");
  });

  it("自然な属性確認を許可済み候補から生成し、Sessionの質問履歴へ記録する", async () => {
    const { bindings, queuedTurn } = await ingestDiary("今日は仕事がつらかった", "collection");
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        mode: "explore",
        reply: "仕事がつらかったんだね。そういえば、どんな仕事をしているの？",
        main_question_count: 1,
        end_session: false,
        daily_prompt_follow_up: "none",
        collection_theme_id: "life_schedule",
        collection_kind: "occupation",
        safety: { route: "normal", restricted_advice: false },
        used_memory_ids: [],
      }),
    });

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    expect(mockGenerateContent.mock.calls[0]?.[0]?.config?.systemInstruction).toContain(
      "life_schedule: occupation, weekly_rhythm, recurring_schedule",
    );
    expect(await accountDataStore.db.select().from(DO.account.schema.chatTurns)).toEqual([
      expect.objectContaining({
        status: "delivered",
        collectionThemeId: "life_schedule",
        collectionKind: "occupation",
      }),
    ]);
  });

  it("保存済み属性の取得に失敗したら属性確認候補をモデルへ渡さない", async () => {
    const { bindings, queuedTurn } = await ingestDiary(
      "今日は仕事がつらかった",
      "collection-state-failure",
    );
    const originalAccountData = bindings.do.accountData;
    if (!originalAccountData) throw new Error("Expected AccountData binding");
    const unavailableAccountData = {
      getByName(name: string) {
        const rpc = originalAccountData.getByName(name);
        return {
          execute(accountId: string, operation: string, ...args: unknown[]) {
            if (operation === "brain.listActivePromptContextKinds") {
              return Promise.reject(new Error("AccountData unavailable"));
            }
            return (rpc.execute as (...parameters: unknown[]) => Promise<unknown>)(
              accountId,
              operation,
              ...args,
            );
          },
        };
      },
    } as unknown as NonNullable<CloudflareBindings["do"]["accountData"]>;
    const warnLog = vi.spyOn(logger, "warn");

    await processChatTurnMessage(
      createQueueMessage(queuedTurn),
      {
        ...bindings,
        do: { ...bindings.do, accountData: unavailableAccountData },
      },
      workerConfig,
    );

    expect(mockGenerateContent.mock.calls[0]?.[0]?.config?.systemInstruction).toContain(
      "この応答では声かけ属性を確認する質問をしない",
    );
    expect(mockGenerateContent.mock.calls[0]?.[0]?.config?.systemInstruction).not.toContain(
      "life_schedule: occupation",
    );
    expect(warnLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "prompt-context.collection-state.failed",
        outcome: "degraded",
      }),
      expect.stringContaining("continue without collection candidates"),
    );
  });

  it("現在TurnでVectorize検索し、AccountDataで再認可した記憶をContext Packageへ入れる", async () => {
    const diaryText = "今日は疲れたので、落ち着く方法を探したい";
    const { bindings, providerAccountId, queuedTurn } = await ingestDiary(
      diaryText,
      "brain-context",
    );
    const [source] = await accountDataStore.db.select().from(DO.account.schema.sourceRecords);
    if (!source) throw new Error("Expected a source record");
    const temporalSearchText = buildDiaryTemporalSearchText(
      diaryText,
      resolveDiaryTemporalContext(diaryText, source.createdAt),
    );
    const recordedAt = new Date("2026-08-10T00:00:00Z");
    await DO.account.action.brain.saveBrainItem(accountDataStore.db, {
      at: recordedAt,
      item: {
        id: "brain-memory",
        accountId: queuedTurn.accountId,
        category: "memory",
        statement: "公園を歩くと落ち着くことがある",
        attributes: {},
        derivation: "ai",
        status: "active",
        stability: "changeable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: { state: "uncomputed" },
      },
      evidence: [
        {
          id: "brain-memory-evidence",
          sourceRecordId: source.id,
          relation: "supports",
          isDerivationTrigger: true,
          derivationMethod: "ai",
          generatedAt: recordedAt,
        },
      ],
      accessLabels: [{ id: "brain-memory-access", label: "private", assignedBy: "system" }],
    });
    await accountDataStore.db.insert(DO.account.schema.brainVectorEntries).values({
      id: "vector-memory",
      brainItemId: "brain-memory",
      itemRevision: recordedAt.getTime(),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    });
    const query = vi.fn().mockResolvedValue({
      matches: [{ id: "vector-memory", score: 0.91 }],
      count: 1,
    });
    bindings.vector = { brain: { query } as unknown as VectorizeIndex };
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        mode: "advise",
        reply: generatedReply,
        main_question_count: 0,
        end_session: false,
        daily_prompt_follow_up: "none",
        collection_theme_id: "none",
        collection_kind: "none",
        safety: { route: "normal", restricted_advice: false },
        used_memory_ids: ["memory-1"],
      }),
    });

    await processChatTurnMessage(
      createQueueMessage(queuedTurn),
      bindings,
      getWorkerConfig({
        ENVIRONMENT: "preview",
        LINE_CHANNEL_ACCESS_TOKEN: "line-token",
        CHAT_DELIVERY_SECRET: "delivery-secret",
        GOOGLE_VERTEX_AI_API_KEY: "google-key",
        BRAIN_VECTOR_HMAC_SECRET: "brain-secret",
      }),
    );

    expect(query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        topK: 10,
        filter: { owner_scope: { $eq: expect.any(String) } },
      }),
    );
    expect(mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: temporalSearchText,
        config: expect.objectContaining({ taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 }),
      }),
    );
    const prompt = mockGenerateContent.mock.calls[0]?.[0]?.contents;
    expect(JSON.parse(prompt).context_package.memories).toEqual([
      expect.objectContaining({
        id: "memory-1",
        statement: "公園を歩くと落ち着くことがある",
        derivation: "ai",
        is_inference: true,
        evidence: [expect.objectContaining({ text: diaryText })],
      }),
    ]);
    const developmentBrainUsage =
      "[dev] 使用したBrain Item\n- 1. Memory: 公園を歩くと落ち着くことがある";
    expect(mockPushMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: providerAccountId,
        messages: [
          { type: "text", text: generatedReply },
          { type: "text", text: developmentBrainUsage },
        ],
      }),
      expect.any(String),
    );
    const savedMessages = await accountDataStore.db
      .select()
      .from(DO.account.schema.conversationMessages);
    expect(savedMessages.find(({ role }) => role === "assistant")?.assistantBody).toBe(
      generatedReply,
    );
    await expect(
      accountDataStore.db.select().from(DO.account.schema.diaryChatBrainUsageAudits),
    ).resolves.toEqual([
      expect.objectContaining({
        brainItemId: "brain-memory",
        purpose: "diary_chat",
        status: "active",
        sourceRecordIds: [source.id],
      }),
    ]);
  });

  it("replyTokenがあればfinalをreplyで返し、pushを消費しない", async () => {
    const { bindings, providerAccountId, queuedTurn } = await ingestDiary(
      "今日は早起きできた",
      "reply-token",
      "reply-token-1",
    );

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    expect(mockReplyMessage).toHaveBeenCalledOnce();
    expect(mockReplyMessage.mock.calls[0]?.[0]).toEqual({
      replyToken: "reply-token-1",
      messages: [
        {
          type: "text",
          text: generatedReply,
        },
      ],
    });
    expect(mockPushMessage).not.toHaveBeenCalled();
    expect(JSON.stringify(queuedTurn)).not.toContain("reply-token-1");
    expect(JSON.stringify(queuedTurn)).not.toContain(providerAccountId);
    const turns = await accountDataStore.db.select().from(DO.account.schema.chatTurns);
    expect(turns).toEqual([
      expect.objectContaining({ id: queuedTurn.turnId, status: "delivered" }),
    ]);
  });

  it("LINEがreplyを4xxで拒否したらretry key付きpushへフォールバックする", async () => {
    const { bindings, providerAccountId, queuedTurn } = await ingestDiary(
      "今日は買い物に行った",
      "reply-fallback",
      "reply-token-2",
    );
    mockReplyMessage.mockRejectedValue(Object.assign(new Error("invalid token"), { status: 400 }));

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    expect(mockReplyMessage).toHaveBeenCalledOnce();
    expect(mockPushMessage).toHaveBeenCalledOnce();
    expect(mockPushMessage.mock.calls[0]?.[0]?.to).toBe(providerAccountId);
    const turns = await accountDataStore.db.select().from(DO.account.schema.chatTurns);
    expect(turns).toEqual([
      expect.objectContaining({ id: queuedTurn.turnId, status: "delivered" }),
    ]);
  });

  it("replyの到達が判別できないときはpushへ切り替えず同じreplyTokenで再送する", async () => {
    const { bindings, queuedTurn } = await ingestDiary(
      "今日は写真を撮った",
      "reply-unknown",
      "reply-token-3",
    );
    // statusを持たない失敗はネットワーク断であり、LINEへ届いたか判別できない。
    mockReplyMessage.mockRejectedValueOnce(new Error("network unreachable"));

    const first = createQueueMessage(queuedTurn);
    const errorLog = vi.spyOn(logger, "error");
    await processChatTurnMessage(first, bindings, workerConfig);

    // ここでpushしてしまうと、replyが実は届いていた場合に二重に届く。
    expect(first.retry).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "queue.message.failed",
        errorCode: "LINE_FINAL_DELIVERY_FAILED",
        stage: "line.deliver",
        retryable: true,
        disposition: "retry",
      }),
      expect.stringContaining("[Chat turn] failed at line.deliver -> retry"),
    );
    expect(mockPushMessage).not.toHaveBeenCalled();
    expect(await turnStatus(queuedTurn.turnId)).toBe("delivery_pending");

    await processChatTurnMessage(createQueueMessage(queuedTurn, 2), bindings, workerConfig);

    expect(mockReplyMessage).toHaveBeenCalledTimes(2);
    expect(mockReplyMessage.mock.calls[1]?.[0]?.replyToken).toBe("reply-token-3");
    expect(mockPushMessage).not.toHaveBeenCalled();
    expect(await turnStatus(queuedTurn.turnId)).toBe("delivered");
  });

  it("連投を1Turnにまとめたら、最新のreplyTokenでreplyを1通だけ返す", async () => {
    const { bindings, queuedTurn } = await ingestDiaryEvents(
      [
        { text: "今日は疲れた", replyToken: "reply-token-old", receivedAgoMs: 5_000 },
        { text: "でも夕飯は作れた", replyToken: "reply-token-new", receivedAgoMs: 1_000 },
      ],
      "coalesced",
    );

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    expect(mockReplyMessage).toHaveBeenCalledOnce();
    expect(mockReplyMessage.mock.calls[0]?.[0]?.replyToken).toBe("reply-token-new");
    expect(mockPushMessage).not.toHaveBeenCalled();
    const prompt = mockGenerateContent.mock.calls[0]?.[0]?.contents;
    expect(JSON.parse(prompt).context_package.messages).toEqual([
      expect.objectContaining({ body: "今日は疲れた" }),
      expect.objectContaining({ body: "でも夕飯は作れた" }),
    ]);
  });

  it("replyTokenが期限切れならreplyを試さずpushで返す", async () => {
    const { bindings, providerAccountId, queuedTurn } = await ingestDiaryEvents(
      [{ text: "今日は昼寝した", replyToken: "reply-token-expired", receivedAgoMs: 120_000 }],
      "reply-expired",
    );

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    expect(mockReplyMessage).not.toHaveBeenCalled();
    expect(mockPushMessage).toHaveBeenCalledOnce();
    expect(mockPushMessage.mock.calls[0]?.[0]?.to).toBe(providerAccountId);
    expect(await turnStatus(queuedTurn.turnId)).toBe("delivered");
  });

  it("replyTokenをD1にもQueue messageにも残さない", async () => {
    const replyToken = "reply-token-secret";
    const { bindings, queuedTurn } = await ingestDiary("今日は掃除した", "no-persist", replyToken);

    await processChatTurnMessage(createQueueMessage(queuedTurn), bindings, workerConfig);

    expect(JSON.stringify(queuedTurn)).not.toContain(replyToken);
    const dump = JSON.stringify([
      await accountDataStore.db.select().from(DO.account.schema.chatTurns),
      await accountDataStore.db.select().from(DO.account.schema.conversationMessages),
      await accountDataStore.db.select().from(DO.account.schema.conversationSessions),
      await accountDataStore.db.select().from(DO.account.schema.sourceRecordTextPayloads),
    ]);
    expect(dump).not.toContain(replyToken);
  });

  it("失敗案内はreplyを使わず固定retry key付きpushで送る", async () => {
    const { bindings, queuedTurn } = await ingestDiary(
      "今日は眠れなかった",
      "failure-uses-push",
      "reply-token-4",
    );
    mockGenerateContent.mockRejectedValue(new Error("gemini unavailable"));

    await processChatTurnMessage(createQueueMessage(queuedTurn, 3), bindings, workerConfig);

    // 失敗案内はfinalではないので、finalのreplyTokenを消費してはいけない。
    expect(mockReplyMessage).not.toHaveBeenCalled();
    expect(mockPushMessage).toHaveBeenCalledOnce();
    expect(mockPushMessage.mock.calls[0]?.[0]?.messages?.[0]?.text).toContain(
      "うまく返事をまとめられませんでした",
    );
    expect(await turnStatus(queuedTurn.turnId)).toBe("failed");
  });

  it("LINEが同じretry keyを409で拒否しても配送済みとして完了する", async () => {
    const { bindings, queuedTurn } = await ingestDiary("今日は本を読めた", "retry-conflict");
    mockPushMessage.mockRejectedValueOnce({ status: 409 });
    const message = createQueueMessage(queuedTurn);

    await processChatTurnMessage(message, bindings, workerConfig);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    await expect(accountDataStore.db.select().from(DO.account.schema.chatTurns)).resolves.toEqual([
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

    await processChatTurnMessage(message, bindings, workerConfig);

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    const messages = await accountDataStore.db
      .select()
      .from(DO.account.schema.conversationMessages);
    expect(messages).toEqual([expect.objectContaining({ role: "user", assistantBody: null })]);
    expect(mockPushMessage).not.toHaveBeenCalled();
  });

  it("生成中にSessionが閉じていれば生成も最終配送も行わない", async () => {
    const { bindings, queuedTurn } = await ingestDiary("今日は区切りをつけたい", "closed-session");
    await accountDataStore.db
      .update(DO.account.schema.conversationSessions)
      .set({ status: "closed", closedAt: new Date(), closeReason: "inactive" });
    const message = createQueueMessage(queuedTurn);

    await processChatTurnMessage(message, bindings, workerConfig);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(mockPushMessage).not.toHaveBeenCalled();
    await expect(accountDataStore.db.select().from(DO.account.schema.chatTurns)).resolves.toEqual([
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
    await expect(accountDataStore.db.select().from(DO.account.schema.chatTurns)).resolves.toEqual([
      expect.objectContaining({ status: "failed", failureStage: "generation_or_delivery" }),
    ]);
    expect(mockPushMessage.mock.calls[0]?.[0]).toEqual(
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
    expect(mockPushMessage).toHaveBeenCalledOnce();
  });

  it("失敗案内の一時障害後はAIを再生成せず同じoutboxだけを再配送する", async () => {
    const { bindings, queuedTurn } = await ingestDiary(
      "今日は言葉が出てこない",
      "failure-transient",
    );
    mockGenerateContent.mockRejectedValue(new Error("provider unavailable"));
    mockPushMessage.mockRejectedValueOnce({ status: 503 }).mockResolvedValue({});
    const first = createQueueMessage(queuedTurn, 2);

    await processChatTurnMessage(first, bindings, workerConfig);
    expect(first.retry).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    const retry = createQueueMessage(queuedTurn, 3);
    await processChatTurnMessage(retry, bindings, workerConfig);

    expect(mockGenerateContent).toHaveBeenCalledOnce();
    expect(retry.ack).toHaveBeenCalledOnce();
    const failureCalls = mockPushMessage.mock.calls;
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

    await processChatTurnMessage(first, bindings, workerConfig);
    expect(first.retry).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    const firstDelivery = deliverTurn.mock.calls[0]?.[0];
    if (!firstDelivery) throw new Error("Expected the first delivery reservation");
    await expect(coordinator.deliverTurn(firstDelivery)).resolves.toEqual({
      status: "lease_expired",
    });
    expect(mockPushMessage).toHaveBeenCalledOnce();
    const retry = createQueueMessage(queuedTurn, 2);
    await processChatTurnMessage(retry, bindings, workerConfig);

    expect(retry.ack).toHaveBeenCalledOnce();
    const finalCalls = mockPushMessage.mock.calls;
    expect(finalCalls).toHaveLength(2);
    expect(finalCalls[0]?.[0]).toEqual(finalCalls[1]?.[0]);
    expect(finalCalls[0]?.[1]).toBe(finalCalls[1]?.[1]);
  });
});
