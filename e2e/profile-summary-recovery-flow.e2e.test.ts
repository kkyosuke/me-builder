import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../apps/api/src";
import {
  type AccountDataTestStore,
  createAccountDataTestStore,
} from "../apps/api/src/testing/account-data";
import { createApplicationSessionFixture } from "../apps/api/src/testing/application-session";
import { createLocalD1 } from "../apps/api/src/testing/local-d1";
import { dispatchUndispatchedProfileSummaryGenerations } from "../apps/worker/src/account-data";
import { type CloudflareBindings, getWorkerConfig } from "../apps/worker/src/config";
import { processProfileSummaryGenerationMessage } from "../apps/worker/src/handler/profile-summary-generation";
import { D1, DO, type ProfileSummaryGenerationContext } from "../packages/lib/src";
import type { Message, ProfileSummaryGenerationQueueMessage, Queue } from "../packages/shared/src";

const { generateProfileSummary } = vi.hoisted(() => ({ generateProfileSummary: vi.fn() }));
vi.mock("../apps/worker/src/logic/profile-summary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apps/worker/src/logic/profile-summary")>()),
  generateProfileSummary,
}));

const repositoryRoot = path.resolve(__dirname, "..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const accountId = "account-summary-recovery-e2e";
const lineId = "line-summary-recovery-e2e";
const timestamp = 1_785_801_600;
const queueMetrics = { backlogCount: 0, backlogBytes: 0 };

type LocalD1 = Awaited<ReturnType<typeof createLocalD1>>;
let localD1: LocalD1;
let database: LocalD1["database"];
let accountDataStore: AccountDataTestStore;
let sessionFixture: ReturnType<typeof createApplicationSessionFixture>;
let sessionHeaders: Record<string, string>;

function queueFromSend(
  send: (message: ProfileSummaryGenerationQueueMessage) => Promise<void>,
): Queue<ProfileSummaryGenerationQueueMessage> {
  return {
    metrics: async () => queueMetrics,
    send: async (message) => {
      await send(message);
      return { metadata: { metrics: queueMetrics } };
    },
    sendBatch: async () => ({ metadata: { metrics: queueMetrics } }),
  };
}

async function applyMigrations(db: LocalD1["database"]): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

async function prepareAccount(db: LocalD1["database"]): Promise<void> {
  await applyMigrations(db);
  await db.batch([
    db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES (?, ?, ?, 0, 'active')`,
      )
      .bind(accountId, timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
      )
      .bind("identity-summary-recovery-e2e", timestamp, timestamp, accountId, lineId),
  ]);
  await D1.shared.action.agreement.acceptCurrentTerms(D1.shared.client.create(db), accountId);
}

async function insertDiaryMessage(): Promise<void> {
  accountDataStore.bind(accountId);
  const receivedAt = new Date(timestamp);
  const source = await DO.account.action.diary.storeLineTextSource(accountDataStore.db, {
    accountId,
    eventId: "profile-summary-recovery-e2e",
    body: "予定に見通しがあると落ち着いて動ける。",
    receivedAt,
  });
  accountDataStore.raw
    .prepare(
      `INSERT INTO conversation_sessions (
         id, created_at, updated_at, is_deleted, account_id, status, started_at,
         last_user_message_at, conversation_policy_id, reply_opportunity_count,
         reply_count, awaiting_reply, next_sequence
       ) VALUES (?, ?, ?, 0, ?, 'closed', ?, ?, 'reflective', 0, 0, 0, 2)`,
    )
    .run("summary-recovery-session", timestamp, timestamp, accountId, timestamp, timestamp);
  accountDataStore.raw
    .prepare(
      `INSERT INTO conversation_messages (
         id, created_at, updated_at, is_deleted, session_id, sequence, role,
         source_record_id, channel
       ) VALUES (?, ?, ?, 0, ?, 1, 'user', ?, 'line')`,
    )
    .run(
      "summary-recovery-message",
      timestamp,
      timestamp,
      "summary-recovery-session",
      source.sourceRecordId,
    );
}

describe("Profile Summary Queue recovery E2E", () => {
  beforeAll(async () => {
    localD1 = await createLocalD1("profile-summary-recovery-e2e");
    database = localD1.database;
    await prepareAccount(database);
  }, 90_000);

  beforeEach(async () => {
    accountDataStore = createAccountDataTestStore();
    await accountDataStore.syncCatalogFrom(D1.shared.client.create(database));
    sessionFixture = createApplicationSessionFixture(database);
    sessionHeaders = (await sessionFixture.issue(accountId)).headers;
    generateProfileSummary.mockImplementation(async (context: ProfileSummaryGenerationContext) => ({
      type: "generated",
      summary: {
        headline: "見通しを持つと落ち着いて動けます",
        insights: [
          {
            key: "planning",
            label: "見通しを持つ",
            description: "予定を把握すると落ち着いて動きやすい傾向があります。",
            evidenceCount: 1,
            sources: ["diary"],
          },
        ],
        compatibilityShareStatements: [
          {
            key: "planning-style",
            label: "予定の立て方",
            statement: "私は、先の見通しを持って動くことを大切にしています",
            evidenceIds: [context.evidence[0]?.id ?? ""],
          },
        ],
      },
      rejectedShareRules: [],
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  afterAll(async () => localD1.dispose());

  it("APIのQueue送信失敗をAlarmが再送し、consumerが同じ生成IDを完了する", async () => {
    await insertDiaryMessage();
    const apiSend = vi.fn(async () => {
      throw new Error("temporary queue outage");
    });
    const apiResponse = await app.request(
      "/api/profile-summary/generations",
      { method: "POST", headers: sessionHeaders },
      {
        DB: database,
        ACCOUNT_DATA: accountDataStore.namespace,
        PROFILE_SUMMARY_QUEUE: queueFromSend(apiSend),
        ...sessionFixture.bindings,
        ENVIRONMENT: "test",
      },
    );
    expect(apiResponse.status).toBe(202);
    const accepted = (await apiResponse.json()) as {
      generationId: string;
      status: string;
      created: boolean;
    };
    expect(accepted).toMatchObject({ status: "queued", created: true });
    expect(apiSend).toHaveBeenCalledOnce();

    accountDataStore.raw
      .prepare("UPDATE profile_summary_generations SET requested_at = ? WHERE id = ?")
      .run(Date.now() - 60_000, accepted.generationId);
    let recoveredMessage: ProfileSummaryGenerationQueueMessage | undefined;
    const recoveryQueue = queueFromSend(async (message) => {
      recoveredMessage = message;
    });
    await expect(
      dispatchUndispatchedProfileSummaryGenerations(accountDataStore.db, accountId, recoveryQueue),
    ).resolves.toBe(1);
    expect(recoveredMessage).toEqual({
      type: "profile-summary-generation",
      accountId,
      generationId: accepted.generationId,
    });
    expect(
      accountDataStore.raw
        .prepare("SELECT dispatched_at FROM profile_summary_generations WHERE id = ?")
        .get(accepted.generationId),
    ).toEqual({ dispatched_at: expect.any(Number) });

    if (!recoveredMessage) throw new Error("Alarm did not recover the Queue message");
    const message: Message<ProfileSummaryGenerationQueueMessage> = {
      id: "profile-summary-recovery-message",
      timestamp: new Date(),
      attempts: 1,
      body: recoveredMessage,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const cf: CloudflareBindings = {
      d1: D1.shared.client.create(database),
      do: { conversation: undefined, accountData: accountDataStore.namespace },
      queue: { chatTurn: undefined, brainCheckpoint: undefined, brainVector: undefined },
      vector: { brain: undefined },
    };
    await processProfileSummaryGenerationMessage(
      message,
      cf,
      getWorkerConfig({
        ENVIRONMENT: "test",
        GOOGLE_VERTEX_AI_API_KEY: "test-key",
        GEMINI_MODEL: "gemini-test",
      }),
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    const readResponse = await app.request(
      "/api/profile-summary",
      { headers: sessionHeaders },
      {
        DB: database,
        ACCOUNT_DATA: accountDataStore.namespace,
        PROFILE_SUMMARY_QUEUE: recoveryQueue,
        ...sessionFixture.bindings,
        ENVIRONMENT: "test",
      },
    );
    expect(readResponse.status).toBe(200);
    expect(await readResponse.json()).toMatchObject({
      versions: [
        {
          isLatest: true,
          summary: { headline: "見通しを持つと落ち着いて動けます" },
        },
      ],
      generation: { status: "idle" },
    });
  });
});
