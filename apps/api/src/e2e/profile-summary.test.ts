import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { D1, DO } from "@me-builder/lib";
import type { ProfileSummaryGenerationQueueMessage, Queue } from "@me-builder/shared";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { type AccountDataTestStore, createAccountDataTestStore } from "../testing/account-data";
import { createApplicationSessionFixture } from "../testing/application-session";
import { profileSummaryCases } from "./case/profile-summary.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const timestamp = 1_785_801_600;
const e2eSetupTimeoutMs = 90_000;

let miniflare: Miniflare;
let database: D1Database;
let accountDataStore: AccountDataTestStore;
let sessionFixture: ReturnType<typeof createApplicationSessionFixture>;
let sessionHeaders: Record<string, string>;
const send = vi.fn();
const queue = { send } as unknown as Queue<ProfileSummaryGenerationQueueMessage>;

async function applyMigrations(db: D1Database): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  }
}

async function prepareAccount(db: D1Database): Promise<void> {
  await applyMigrations(db);
  await db.batch([
    db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES (?, ?, ?, 0, 'active')`,
      )
      .bind("account-summary-e2e", timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
      )
      .bind(
        "identity-summary-e2e",
        timestamp,
        timestamp,
        "account-summary-e2e",
        "line-summary-e2e",
      ),
  ]);
  await D1.shared.action.agreement.acceptCurrentTerms(
    D1.shared.client.create(db),
    "account-summary-e2e",
  );
}

async function insertDiaryMessage(
  suffix = "initial",
  receivedAt = new Date(timestamp),
): Promise<string> {
  accountDataStore.bind("account-summary-e2e");
  const source = await DO.account.action.diary.storeLineTextSource(accountDataStore.db, {
    accountId: "account-summary-e2e",
    eventId: crypto.randomUUID(),
    body: "Memory化されていない日記本文",
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
    .run(
      `summary-session-${suffix}`,
      receivedAt.getTime(),
      receivedAt.getTime(),
      "account-summary-e2e",
      receivedAt.getTime(),
      receivedAt.getTime(),
    );
  accountDataStore.raw
    .prepare(
      `INSERT INTO conversation_messages (
         id, created_at, updated_at, is_deleted, session_id, sequence, role,
         source_record_id, channel
       ) VALUES (?, ?, ?, 0, ?, 1, 'user', ?, 'line')`,
    )
    .run(
      `summary-message-${suffix}`,
      receivedAt.getTime(),
      receivedAt.getTime(),
      `summary-session-${suffix}`,
      source.sourceRecordId,
    );
  return source.sourceRecordId;
}

async function insertSummaryVersions(evidenceSourceRecordId: string): Promise<void> {
  const intervalMs = 31 * 24 * 60 * 60 * 1_000;
  const firstGeneratedAt = new Date("2026-06-01T00:00:00.000Z").getTime();
  for (const sequence of [1, 2, 3]) {
    const generatedAt = new Date(firstGeneratedAt + (sequence - 1) * intervalMs);
    const request = await DO.account.action.profileSummary.requestProfileSummaryGeneration(
      accountDataStore.db,
      "account-summary-e2e",
      generatedAt,
      true,
    );
    if (request.outcome !== "created") throw new Error("summary generation was not created");
    await DO.account.action.profileSummary.completeProfileSummaryGeneration(
      accountDataStore.db,
      "account-summary-e2e",
      {
        generationId: request.generationId,
        generatedAt,
        model: "gemini-test",
        promptVersion: "profile-summary-v1",
        headline: `${sequence}番目のまとめ`,
        insights: [],
        compatibilityShareStatements: [
          {
            key: `summary-${sequence}`,
            label: "共有用",
            statement: "私は、振り返る時間を大切にしています",
            evidenceIds: [`diary:${evidenceSourceRecordId}`],
          },
        ],
        diagnosisCount: 0,
        diaryCount: 1,
        latestRecordedAt: new Date(timestamp),
        inputSnapshot: {
          diagnosis: { count: 0, latestRecordedAt: null },
          diary: { count: 1, latestRecordedAt: new Date(timestamp) },
        },
      },
    );
  }
}

async function request(
  pathname = "/api/profile-summary",
  method = "GET",
  environment = "test",
): Promise<Response> {
  return app.request(
    pathname,
    { method, headers: sessionHeaders },
    {
      DB: database,
      ACCOUNT_DATA: accountDataStore.namespace,
      PROFILE_SUMMARY_QUEUE: queue,
      ...sessionFixture.bindings,
      ENVIRONMENT: environment,
    },
  );
}

describe("Profile Summary local D1 E2E", () => {
  beforeAll(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "profile-summary-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareAccount(database);
    sessionFixture = createApplicationSessionFixture(database);
  }, e2eSetupTimeoutMs);

  beforeEach(async () => {
    accountDataStore = createAccountDataTestStore();
    await accountDataStore.syncCatalogFrom(D1.shared.client.create(database));
    send.mockReset();
    send.mockResolvedValue(undefined);
    sessionHeaders = (await sessionFixture.issue("account-summary-e2e")).headers;
  });

  afterAll(async () => miniflare.dispose());

  it(`${profileSummaryCases.noRecords.id}: ${profileSummaryCases.noRecords.name}`, async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      versions: [],
      availableDataCounts: { diagnosis: 0, diary: 0 },
    });
  });

  it(`${profileSummaryCases.readVersions.id}: ${profileSummaryCases.readVersions.name}`, async () => {
    const evidenceSourceRecordId = await insertDiaryMessage();
    await insertSummaryVersions(evidenceSourceRecordId);

    const response = await request();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      versions: Array<{ id: string; isLatest: boolean; summary: { headline: string } }>;
      availableDataCounts: { diagnosis: number; diary: number };
      generation: {
        status: string;
        canRegenerate: boolean;
        reasons: string[];
        message: string | null;
      };
    };
    expect(body.versions).toHaveLength(3);
    expect(body.versions.filter(({ isLatest }) => isLatest)).toHaveLength(1);
    expect(new Set(body.versions.map(({ summary }) => summary.headline)).size).toBe(3);
    expect(body.availableDataCounts).toEqual({ diagnosis: 0, diary: 1 });
    expect(body.generation).toEqual({
      status: "idle",
      canRegenerate: true,
      reasons: [],
      message: null,
    });
  });

  it("開発環境では変更がなくても再生成でき、本番では通常判定を維持する", async () => {
    const evidenceSourceRecordId = await insertDiaryMessage();
    await insertSummaryVersions(evidenceSourceRecordId);

    const productionRead = await request("/api/profile-summary", "GET", "production");
    expect((await productionRead.json()).generation).toMatchObject({
      canRegenerate: false,
      reasons: [],
    });
    const productionRequest = await request(
      "/api/profile-summary/generations",
      "POST",
      "production",
    );
    expect(productionRequest.status).toBe(409);
    expect(await productionRequest.json()).toMatchObject({
      reason: "regeneration_not_required",
    });

    const developmentRead = await request();
    expect((await developmentRead.json()).generation).toMatchObject({
      canRegenerate: true,
      reasons: [],
    });
    const developmentRequest = await request("/api/profile-summary/generations", "POST");
    expect(developmentRequest.status).toBe(202);
    expect(await developmentRequest.json()).toMatchObject({ created: true, status: "queued" });
  });

  it(`${profileSummaryCases.requestGeneration.id}: ${profileSummaryCases.requestGeneration.name}`, async () => {
    await insertDiaryMessage();

    const response = await request("/api/profile-summary/generations", "POST");
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "queued", created: true });
    expect(send).toHaveBeenCalledWith({
      type: "profile-summary-generation",
      accountId: "account-summary-e2e",
      generationId: expect.any(String),
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("Memory化されていない日記本文");
    expect((await (await request()).json()).generation).toMatchObject({
      status: "queued",
      canRegenerate: false,
    });
  });

  it("日記が増えるとGETが再生成理由を返し、POSTで新しい要求を受け付ける", async () => {
    const evidenceSourceRecordId = await insertDiaryMessage();
    await insertSummaryVersions(evidenceSourceRecordId);
    await insertDiaryMessage("added", new Date("2026-08-10T00:00:00.000Z"));

    expect((await (await request()).json()).generation).toEqual({
      status: "idle",
      canRegenerate: true,
      reasons: ["brain"],
      message: null,
    });
    const response = await request("/api/profile-summary/generations", "POST");
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ created: true, status: "queued" });
  });
});
