import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { saveDiagnosisAnswer } from "./diagnosis";
import { storeLineTextSource } from "./diary";
import {
  correctPersonalDataRecord,
  deletePersonalDataRecord,
  hasActiveSourceRecords,
  listPersonalDataRecords,
} from "./source";

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
  const recordedAt = new Date("2026-08-15T01:00:00.000Z");
  await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
  const source = await storeLineTextSource(db, {
    accountId,
    eventId: "event-1",
    body: "最初の日記",
    receivedAt: recordedAt,
  });
  await db.insert(schema.conversationSessions).values({
    id: "session-1",
    accountId,
    status: "closed",
    startedAt: recordedAt,
    lastUserMessageAt: recordedAt,
    lastAssistantMessageAt: recordedAt,
    closedAt: recordedAt,
    closeReason: "explicit",
    nextSequence: 3,
  });
  await db.insert(schema.conversationMessages).values({
    id: "message-1",
    sessionId: "session-1",
    sequence: 1,
    role: "user",
    sourceRecordId: source.sourceRecordId,
    channel: "line",
  });
  await db.insert(schema.chatTurns).values({
    id: "turn-1",
    sessionId: "session-1",
    fromSequence: 1,
    throughSequence: 1,
    generationEpoch: 1,
    status: "delivered",
    promptVersion: "test",
    model: "test",
    receivedAt: recordedAt,
    responseMessageId: "assistant-1",
  });
  await db.insert(schema.conversationMessages).values({
    id: "assistant-1",
    sessionId: "session-1",
    sequence: 2,
    role: "assistant",
    assistantBody: "古い内容を前提にした返信",
    channel: "line",
    turnId: "turn-1",
  });
  await db.insert(schema.brainItems).values({
    id: "brain-1",
    accountId,
    category: "preference",
    statement: "最初の日記が好き",
    attributes: {},
    derivation: "ai",
    status: "active",
    stability: "changeable",
    sensitivity: "normal",
    confidence: { state: "uncomputed" },
  });
  await db.insert(schema.brainItemEvidenceEdges).values({
    id: "edge-1",
    brainItemId: "brain-1",
    sourceRecordId: source.sourceRecordId,
    relation: "supports",
    isDerivationTrigger: true,
    derivationMethod: "ai",
    generatedAt: recordedAt,
  });
  await db.insert(schema.profileSummaryGenerations).values({
    id: "summary-generation-1",
    accountId,
    status: "completed",
    requestedAt: recordedAt,
    finishedAt: recordedAt,
    model: "test",
    promptVersion: "test",
  });
  await db.insert(schema.profileSummaryVersions).values({
    id: "summary-version-1",
    generationId: "summary-generation-1",
    sequence: 1,
    generatedAt: recordedAt,
    model: "test",
    promptVersion: "test",
    diagnosisInputCount: 0,
    diaryInputCount: 1,
    diaryInputLatestAt: recordedAt,
    summary: {
      generatedAt: recordedAt.toISOString(),
      headline: "古い日記から作ったまとめ",
      insights: [],
      recordCount: 1,
      diagnosisCount: 0,
      diaryCount: 1,
      latestRecordedAt: recordedAt.toISOString(),
    },
  });
  await db.insert(schema.profileSummaryShareProjections).values({
    profileSummaryVersionId: "summary-version-1",
    schemaVersion: 1,
    generatedAt: recordedAt,
    statements: [],
    evidenceReferences: [`diary:${source.sourceRecordId}`],
    fingerprint: "f".repeat(64),
  });
  return { accountId, sourceRecordId: source.sourceRecordId };
}

async function insertDiagnosisFixture(db: AccountDataDatabase) {
  const accountId = "diagnosis-account";
  const diagnosisId = "diagnosis-1";
  const questionId = "question-1";
  const diagnosisQuestionId = "diagnosis-question-1";
  const recordedAt = new Date("2026-08-15T01:00:00.000Z");
  await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
  await db.insert(schema.questions).values({ id: questionId });
  await db.insert(schema.questionVersions).values({
    questionId,
    version: 1,
    state: "approved",
    text: "朝は得意ですか？",
    format: "single_choice",
    approvedAt: recordedAt,
  });
  await db.insert(schema.questionChoices).values([
    { questionId, questionVersion: 1, choiceId: "no", label: "いいえ", position: 0 },
    { questionId, questionVersion: 1, choiceId: "yes", label: "はい", position: 1 },
  ]);
  await db.insert(schema.diagnoses).values({
    id: diagnosisId,
    title: "生活診断",
    state: "published",
    opensAt: new Date("2026-08-01T00:00:00.000Z"),
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await db.insert(schema.diagnosisQuestions).values({
    id: diagnosisQuestionId,
    diagnosisId,
    questionId,
    questionVersion: 1,
    position: 0,
  });
  await saveDiagnosisAnswer(db, {
    accountId,
    diagnosisId,
    diagnosisQuestionId,
    choiceId: "no",
    at: recordedAt,
  });
  const answer = db
    .select({ sourceRecordId: schema.diagnosisAnswers.sourceRecordId })
    .from(schema.diagnosisAnswers)
    .where(eq(schema.diagnosisAnswers.isDeleted, false))
    .get();
  if (!answer) throw new Error("診断回答fixtureを作成できませんでした");
  await db.insert(schema.brainItems).values({
    id: "diagnosis-brain-1",
    accountId,
    category: "trait",
    statement: "朝は苦手",
    attributes: {},
    derivation: "deterministic",
    status: "active",
    stability: "stable",
    sensitivity: "normal",
    confidence: { state: "uncomputed" },
  });
  await db.insert(schema.brainItemEvidenceEdges).values({
    id: "diagnosis-edge-1",
    brainItemId: "diagnosis-brain-1",
    sourceRecordId: answer.sourceRecordId,
    relation: "supports",
    isDerivationTrigger: true,
    derivationMethod: "deterministic",
    generatedAt: recordedAt,
  });
  return { accountId, diagnosisId, sourceRecordId: answer.sourceRecordId };
}

describe("hasActiveSourceRecords", () => {
  it("有効な記録だけを判定する", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
    await db.insert(schema.sourceRecords).values([
      { id: "active", accountId: "account-1", kind: "user_input" },
      { id: "deleted", accountId: "account-1", kind: "user_input", isDeleted: true },
    ]);

    await expect(hasActiveSourceRecords(db, "account-1")).resolves.toBe(true);
    await expect(hasActiveSourceRecords(db, "unknown")).resolves.toBe(false);
  });
});

describe("source records", () => {
  it("Objectに固定したAccount以外のSource Recordを保存できない", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });

    await expect(
      db
        .insert(schema.sourceRecords)
        .values({ id: "foreign", accountId: "account-2", kind: "user_input" }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("日記の訂正で新版を作り、古い派生物を利用不能へ収束させる", async () => {
    const db = createTestDb();
    const { accountId, sourceRecordId } = await insertDiaryFixture(db);
    const correctedAt = new Date("2026-08-15T02:00:00.000Z");

    const result = await correctPersonalDataRecord(
      db,
      accountId,
      sourceRecordId,
      { kind: "diary", value: "訂正後の日記" },
      correctedAt,
    );

    expect(result).toMatchObject({ type: "updated", invalidatedBrainItemCount: 1 });
    if (result.type !== "updated") throw new Error("訂正結果が不正です");
    expect(result.recordId).not.toBe(sourceRecordId);
    expect(
      db
        .select()
        .from(schema.sourceRecordRevisions)
        .where(eq(schema.sourceRecordRevisions.previousSourceRecordId, sourceRecordId))
        .get(),
    ).toMatchObject({ nextSourceRecordId: result.recordId });
    expect(
      db
        .select()
        .from(schema.sourceRecordTextPayloads)
        .where(eq(schema.sourceRecordTextPayloads.sourceRecordId, result.recordId))
        .get()?.body,
    ).toBe("訂正後の日記");
    expect(
      db
        .select()
        .from(schema.conversationMessages)
        .where(eq(schema.conversationMessages.id, "assistant-1"))
        .get()?.isDeleted,
    ).toBe(true);
    expect(
      db.select().from(schema.brainItems).where(eq(schema.brainItems.id, "brain-1")).get()?.status,
    ).toBe("invalidated");
    expect(
      db
        .select()
        .from(schema.brainVectorSyncJobs)
        .where(eq(schema.brainVectorSyncJobs.brainItemId, "brain-1"))
        .get()?.operation,
    ).toBe("delete");
    expect(await db.select().from(schema.profileSummaryVersions)).toHaveLength(1);
    expect(await db.select().from(schema.profileSummaryShareProjections)).toEqual([]);
    await expect(listPersonalDataRecords(db, accountId)).resolves.toMatchObject([
      { id: result.recordId, kind: "diary", value: "訂正後の日記" },
    ]);
  });

  it("診断回答の訂正と個別削除を拒否して保存済み回答を維持する", async () => {
    const db = createTestDb();
    const { accountId, sourceRecordId } = await insertDiagnosisFixture(db);

    await expect(
      correctPersonalDataRecord(
        db,
        accountId,
        sourceRecordId,
        { kind: "diary", value: "診断を日記として変更" },
        new Date("2026-08-15T02:00:00.000Z"),
      ),
    ).resolves.toEqual({ type: "immutable-diagnosis" });
    await expect(
      deletePersonalDataRecord(db, accountId, sourceRecordId, new Date("2026-08-15T03:00:00.000Z")),
    ).resolves.toEqual({ type: "immutable-diagnosis" });
    expect(
      db
        .select()
        .from(schema.diagnosisAnswers)
        .where(eq(schema.diagnosisAnswers.isDeleted, false))
        .get(),
    ).toMatchObject({ choiceId: "no", sourceRecordId });
    expect(
      db.select().from(schema.brainItems).where(eq(schema.brainItems.id, "diagnosis-brain-1")).get()
        ?.status,
    ).toBe("active");
    await expect(listPersonalDataRecords(db, accountId)).resolves.toMatchObject([
      { id: sourceRecordId, kind: "diagnosis", value: "いいえ" },
    ]);
  });

  it("日記の削除で本文を消し、tombstoneと来歴だけを残す", async () => {
    const db = createTestDb();
    const { accountId, sourceRecordId } = await insertDiaryFixture(db);

    await expect(
      deletePersonalDataRecord(db, accountId, sourceRecordId, new Date("2026-08-15T02:00:00.000Z")),
    ).resolves.toMatchObject({
      type: "deleted",
      recordId: sourceRecordId,
      invalidatedBrainItemCount: 1,
    });

    expect(
      db
        .select()
        .from(schema.sourceRecords)
        .where(eq(schema.sourceRecords.id, sourceRecordId))
        .get()?.isDeleted,
    ).toBe(true);
    expect(
      db
        .select()
        .from(schema.sourceRecordTextPayloads)
        .where(eq(schema.sourceRecordTextPayloads.sourceRecordId, sourceRecordId))
        .get(),
    ).toBeUndefined();
    expect(
      db
        .select()
        .from(schema.brainItemEvidenceEdges)
        .where(eq(schema.brainItemEvidenceEdges.sourceRecordId, sourceRecordId))
        .get(),
    ).toBeDefined();
    expect(await db.select().from(schema.profileSummaryVersions)).toHaveLength(1);
    expect(await db.select().from(schema.profileSummaryShareProjections)).toEqual([]);
    await expect(listPersonalDataRecords(db, accountId)).resolves.toEqual([]);
  });
});
