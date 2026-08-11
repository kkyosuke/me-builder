import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { storeLineTextSource } from "./diary";
import {
  PROFILE_SUMMARY_REGENERATION_INTERVAL_MS,
  completeProfileSummaryGeneration,
  loadProfileSummaryGenerationContext,
  readProfileSummary,
  requestProfileSummaryGeneration,
} from "./profile-summary";

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  type RunnableQuery = PromiseLike<unknown> & { run(): unknown };
  const runBatch = sqlite.transaction((queries: RunnableQuery[]) =>
    queries.map((query) => query.run()),
  );
  Object.assign(db, { batch: async (queries: RunnableQuery[]) => runBatch(queries) });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  return db as unknown as AccountDataDatabase;
}

async function insertDiaryFixture(db: AccountDataDatabase) {
  const accountId = "account-1";
  const recordedAt = new Date("2026-08-08T00:00:00.000Z");
  await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
  const source = await storeLineTextSource(db, {
    accountId,
    eventId: "event-summary-1",
    body: "Memoryにはしていないけれど、今日は海辺を長く歩いて落ち着いた。",
    receivedAt: recordedAt,
  });
  await db.insert(schema.conversationSessions).values({
    id: "session-summary-1",
    accountId,
    status: "closed",
    startedAt: recordedAt,
    lastUserMessageAt: recordedAt,
    closedAt: recordedAt,
    closeReason: "explicit",
  });
  await db.insert(schema.conversationMessages).values({
    id: "message-summary-1",
    sessionId: "session-summary-1",
    sequence: 1,
    role: "user",
    sourceRecordId: source.sourceRecordId,
    channel: "line",
  });
  return { accountId, recordedAt };
}

async function insertAdditionalDiary(
  db: AccountDataDatabase,
  accountId: string,
  suffix: string,
  recordedAt: Date,
) {
  const source = await storeLineTextSource(db, {
    accountId,
    eventId: `event-${suffix}`,
    body: `追加の日記 ${suffix}`,
    receivedAt: recordedAt,
  });
  await db.insert(schema.conversationSessions).values({
    id: `session-${suffix}`,
    accountId,
    status: "closed",
    startedAt: recordedAt,
    lastUserMessageAt: recordedAt,
    closedAt: recordedAt,
    closeReason: "explicit",
  });
  await db.insert(schema.conversationMessages).values({
    id: `message-${suffix}`,
    sessionId: `session-${suffix}`,
    sequence: 1,
    role: "user",
    sourceRecordId: source.sourceRecordId,
    channel: "line",
  });
}

async function insertDiagnosisInput(db: AccountDataDatabase, accountId: string, recordedAt: Date) {
  await db.insert(schema.diagnosisScoringConfigs).values({
    id: "summary-scoring",
    version: 1,
    definition: {},
  });
  await db.insert(schema.diagnoses).values({
    id: "summary-diagnosis",
    title: "まとめ判定用診断",
    scoringConfigId: "summary-scoring",
    opensAt: recordedAt,
    state: "published",
    publishedAt: recordedAt,
  });
  await db.insert(schema.brainItems).values({
    id: "summary-diagnosis-brain",
    accountId,
    category: "diagnosis",
    statement: "予定を立てることを重視する",
    attributes: {},
    derivation: "deterministic",
    status: "active",
    stability: "changeable",
    sensitivity: "private",
    confidence: {},
    createdAt: recordedAt,
    updatedAt: recordedAt,
  });
  await db.insert(schema.diagnosisBrainProjectionHeads).values({
    id: "summary-diagnosis-head",
    accountId,
    diagnosisId: "summary-diagnosis",
    scoringConfigId: "summary-scoring",
    scoringConfigVersion: 1,
    parameterId: "planning",
    currentBrainItemId: "summary-diagnosis-brain",
    contentSignature: "summary-signature",
    createdAt: recordedAt,
    updatedAt: recordedAt,
  });
}

describe("Profile Summary persistence", () => {
  it("Memory化されていない日記からcontextを作り、不変版を冪等に保存する", async () => {
    const db = createTestDb();
    const { accountId, recordedAt } = await insertDiaryFixture(db);
    const requested = await requestProfileSummaryGeneration(
      db,
      accountId,
      new Date("2026-08-09T00:00:00.000Z"),
    );
    expect(requested).toMatchObject({ outcome: "created", status: "queued" });
    if (requested.outcome !== "created") throw new Error("generation was not created");
    await expect(requestProfileSummaryGeneration(db, accountId)).resolves.toMatchObject({
      outcome: "existing",
      generationId: requested.generationId,
    });

    const context = await loadProfileSummaryGenerationContext(
      db,
      accountId,
      requested.generationId,
    );
    expect(context).toMatchObject({ diagnosisCount: 0, diaryCount: 1 });
    expect(context?.inputSnapshot).toEqual({
      diagnosis: { count: 0, latestRecordedAt: null },
      diary: { count: 1, latestRecordedAt: recordedAt },
    });
    expect(context?.evidence).toEqual([
      expect.objectContaining({
        source: "diary",
        text: "Memoryにはしていないけれど、今日は海辺を長く歩いて落ち着いた。",
      }),
    ]);
    if (!context) throw new Error("generation context was not loaded");

    const input = {
      generationId: requested.generationId,
      generatedAt: new Date("2026-08-09T00:01:00.000Z"),
      model: "gemini-test",
      promptVersion: "profile-summary-v1",
      headline: "歩く時間が気持ちを整えています",
      insights: [
        {
          key: "walking",
          label: "歩いて整える",
          description: "歩くことで落ち着きを取り戻すことがあります。",
          evidenceCount: 1,
          sources: ["diary" as const],
        },
      ],
      diagnosisCount: context.diagnosisCount,
      diaryCount: context.diaryCount,
      latestRecordedAt: context.latestRecordedAt,
      inputSnapshot: context.inputSnapshot,
    };
    await expect(completeProfileSummaryGeneration(db, accountId, input)).resolves.toBe(true);
    await expect(
      readProfileSummary(db, accountId, new Date("2026-08-09T00:02:00.000Z")),
    ).resolves.toMatchObject({
      versions: [
        {
          sequence: 1,
          isLatest: true,
          summary: { headline: "歩く時間が気持ちを整えています", diaryCount: 1 },
        },
      ],
      generation: { status: "idle", canRegenerate: false, reasons: [] },
    });
    await expect(
      completeProfileSummaryGeneration(db, accountId, {
        ...input,
        generatedAt: new Date("2026-08-09T00:02:00.000Z"),
        headline: "重複版",
        latestRecordedAt: recordedAt,
      }),
    ).resolves.toBe(true);
    expect((await readProfileSummary(db, accountId)).versions).toHaveLength(1);
  });

  it("利用できる入力がなければ生成要求を作らない", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
    await expect(requestProfileSummaryGeneration(db, "account-1")).resolves.toEqual({
      outcome: "unavailable",
      reason: "source_record_required",
    });
  });

  it("最新版の入力snapshotと比較して診断・日記・30日経過を再生成理由にする", async () => {
    const db = createTestDb();
    const { accountId } = await insertDiaryFixture(db);
    const generatedAt = new Date("2026-08-09T00:00:00.000Z");
    const requested = await requestProfileSummaryGeneration(db, accountId, generatedAt);
    if (requested.outcome !== "created") throw new Error("generation was not created");
    const context = await loadProfileSummaryGenerationContext(
      db,
      accountId,
      requested.generationId,
      generatedAt,
    );
    if (!context) throw new Error("generation context was not loaded");
    await completeProfileSummaryGeneration(db, accountId, {
      generationId: context.generationId,
      generatedAt,
      model: "gemini-test",
      promptVersion: "profile-summary-v1",
      headline: "最初のまとめ",
      insights: [],
      diagnosisCount: context.diagnosisCount,
      diaryCount: context.diaryCount,
      latestRecordedAt: context.latestRecordedAt,
      inputSnapshot: context.inputSnapshot,
    });

    await expect(
      requestProfileSummaryGeneration(db, accountId, new Date("2026-08-09T00:01:00.000Z")),
    ).resolves.toEqual({ outcome: "unavailable", reason: "regeneration_not_required" });

    const addedAt = new Date("2026-08-10T00:00:00.000Z");
    await insertDiagnosisInput(db, accountId, addedAt);
    await insertAdditionalDiary(db, accountId, "second", addedAt);
    await expect(readProfileSummary(db, accountId, addedAt)).resolves.toMatchObject({
      generation: { canRegenerate: true, reasons: ["diagnosis", "brain"] },
    });

    const elapsedAt = new Date(generatedAt.getTime() + PROFILE_SUMMARY_REGENERATION_INTERVAL_MS);
    await expect(readProfileSummary(db, accountId, elapsedAt)).resolves.toMatchObject({
      generation: { canRegenerate: true, reasons: ["diagnosis", "brain", "elapsed"] },
    });
  });
});
