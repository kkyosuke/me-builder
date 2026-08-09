import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import {
  processDiagnosisBrainProjectionRequest,
  processLatestDiagnosisBrainProjection,
  processPendingDiagnosisBrainProjections,
} from "./diagnosis-brain-projection";

function createTestDb(): D1Client {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  type RunnableQuery = PromiseLike<unknown> & { run(): unknown };
  const runBatch = sqlite.transaction((queries: RunnableQuery[]) =>
    queries.map((query) => query.run()),
  );
  Object.assign(db, {
    batch: async (queries: RunnableQuery[]) => runBatch(queries),
  });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  return db as unknown as D1Client;
}

async function insertFixture(db: D1Client, complete: boolean) {
  const at = new Date("2026-08-08T00:00:00Z");
  await db.insert(schema.accounts).values({ id: "account-1" });
  for (const position of [1, 2]) {
    const questionId = `question-${position}`;
    await db.insert(schema.questions).values({ id: questionId });
    await db.insert(schema.questionVersions).values({
      questionId,
      version: 1,
      state: "approved",
      text: `質問${position}`,
      format: "single_choice",
      approvedAt: at,
    });
    await db.insert(schema.questionChoices).values([
      { questionId, questionVersion: 1, choiceId: "no", label: "いいえ", position: 0 },
      { questionId, questionVersion: 1, choiceId: "yes", label: "はい", position: 1 },
    ]);
  }
  await db.insert(schema.diagnosisScoringConfigs).values({
    id: "scoring-1",
    version: 1,
    definition: {
      parameters: [{ id: "planning", label: "計画性", lowLabel: "即興的", highLabel: "計画的" }],
      choiceScores: { yes: 1, no: -1 },
      questions: {
        "question-1": { questionVersion: 1, weights: { planning: 1 } },
        "question-2": { questionVersion: 1, weights: { planning: 1 } },
      },
      minimumCoverage: 0.6,
      lowMaximum: 35,
      highMinimum: 65,
      balancedLabel: "状況による",
    },
  });
  await db.insert(schema.diagnoses).values({
    id: "diagnosis-1",
    title: "診断",
    description: "説明",
    scoringConfigId: "scoring-1",
    opensAt: at,
    state: "published",
    publishedAt: at,
  });
  await db.insert(schema.diagnosisQuestions).values(
    [1, 2].map((position) => ({
      id: `diagnosis-question-${position}`,
      diagnosisId: "diagnosis-1",
      questionId: `question-${position}`,
      questionVersion: 1,
      position,
    })),
  );
  await db.insert(schema.diagnosisResponses).values({
    id: "response-1",
    accountId: "account-1",
    diagnosisId: "diagnosis-1",
    revision: complete ? 2 : 1,
  });
  const answeredPositions = complete ? [1, 2] : [1];
  for (const position of answeredPositions) {
    await db.insert(schema.sourceRecords).values({
      id: `source-${position}`,
      accountId: "account-1",
      kind: "user_input",
    });
    await db.insert(schema.diagnosisAnswers).values({
      id: `answer-${position}`,
      diagnosisResponseId: "response-1",
      diagnosisQuestionId: `diagnosis-question-${position}`,
      questionId: `question-${position}`,
      questionVersion: 1,
      choiceId: "yes",
      acceptedAt: at,
      sourceRecordId: `source-${position}`,
    });
  }
  await db.insert(schema.diagnosisBrainProjectionRequests).values({
    id: "request-1",
    diagnosisResponseId: "response-1",
    responseRevision: answeredPositions.length,
    status: "pending",
    nextAttemptAt: at,
  });
  return at;
}

async function insertProjectionRequest(
  db: D1Client,
  input: { id: string; responseRevision: number; at: Date },
) {
  await db.insert(schema.diagnosisBrainProjectionRequests).values({
    id: input.id,
    diagnosisResponseId: "response-1",
    responseRevision: input.responseRevision,
    status: "pending",
    nextAttemptAt: input.at,
  });
}

async function replaceAnswerSources(db: D1Client, at: Date, choiceId: "yes" | "no" = "yes") {
  for (const position of [1, 2]) {
    const sourceRecordId = `source-revised-${position}`;
    await db.insert(schema.sourceRecords).values({
      id: sourceRecordId,
      accountId: "account-1",
      kind: "user_input",
    });
    await db
      .update(schema.diagnosisAnswers)
      .set({ sourceRecordId, choiceId, acceptedAt: at })
      .where(eq(schema.diagnosisAnswers.diagnosisQuestionId, `diagnosis-question-${position}`));
  }
}

describe("Diagnosis Brain projection", () => {
  it("回答済み診断からactiveなBrain ItemとEvidenceを作る", async () => {
    const db = createTestDb();
    const at = await insertFixture(db, true);
    await db.insert(schema.diagnosisBrainProjectionRequests).values({
      id: "request-old",
      diagnosisResponseId: "response-1",
      responseRevision: 1,
      status: "pending",
      nextAttemptAt: at,
    });

    await expect(
      processLatestDiagnosisBrainProjection(db, "account-1", "diagnosis-1", at),
    ).resolves.toEqual({
      processed: 1,
      applied: 1,
      skippedIncomplete: 0,
      skippedInvalidConfig: 0,
      failed: 0,
    });
    expect(await db.select().from(schema.brainItems)).toEqual([
      expect.objectContaining({
        accountId: "account-1",
        category: "preference",
        statement: "計画性は「計画的」の傾向がある",
        derivation: "deterministic",
        status: "active",
      }),
    ]);
    expect(await db.select().from(schema.brainItemEvidenceEdges)).toHaveLength(2);
    expect(await db.select().from(schema.brainItemAccessLabels)).toEqual([
      expect.objectContaining({
        accountId: "account-1",
        label: "unclassified",
        assignedBy: "system",
      }),
    ]);
    expect(
      await db
        .select({ status: schema.diagnosisBrainProjectionRequests.status })
        .from(schema.diagnosisBrainProjectionRequests),
    ).toEqual([{ status: "applied" }, { status: "applied" }]);
  });

  it("回答途中ならItemを作らず正常終了する", async () => {
    const db = createTestDb();
    const at = await insertFixture(db, false);

    await expect(processPendingDiagnosisBrainProjections(db, { at })).resolves.toEqual({
      processed: 1,
      applied: 0,
      skippedIncomplete: 1,
      skippedInvalidConfig: 0,
      failed: 0,
    });
    expect(await db.select().from(schema.brainItems)).toHaveLength(0);
  });

  it("同じrequestの並行実行では一方だけがleaseを取得する", async () => {
    const db = createTestDb();
    const at = await insertFixture(db, true);

    const results = await Promise.all([
      processDiagnosisBrainProjectionRequest(db, "request-1", at),
      processDiagnosisBrainProjectionRequest(db, "request-1", at),
    ]);

    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.applied, 0)).toBe(1);
    expect(await db.select().from(schema.brainItems)).toHaveLength(1);
    expect(await db.select().from(schema.brainItemEvidenceEdges)).toHaveLength(2);
  });

  it("意味内容が同じ再回答ではItemを増やさず現在のEvidenceを追加する", async () => {
    const db = createTestDb();
    const at = await insertFixture(db, true);
    await processDiagnosisBrainProjectionRequest(db, "request-1", at);
    const revisedAt = new Date(at.getTime() + 1000);
    await replaceAnswerSources(db, revisedAt);
    await insertProjectionRequest(db, { id: "request-2", responseRevision: 3, at: revisedAt });

    await expect(
      processDiagnosisBrainProjectionRequest(db, "request-2", revisedAt),
    ).resolves.toMatchObject({ applied: 1, failed: 0 });

    expect(await db.select().from(schema.brainItems)).toHaveLength(1);
    expect(await db.select().from(schema.brainItemEvidenceEdges)).toHaveLength(4);
    expect(await db.select().from(schema.brainItemRevisions)).toHaveLength(0);
  });

  it("異なるrequestを並行処理しても改訂を分岐させない", async () => {
    const db = createTestDb();
    const at = await insertFixture(db, true);
    await processDiagnosisBrainProjectionRequest(db, "request-1", at);
    const revisedAt = new Date(at.getTime() + 1000);
    await replaceAnswerSources(db, revisedAt, "no");
    await insertProjectionRequest(db, { id: "request-2", responseRevision: 3, at: revisedAt });
    await insertProjectionRequest(db, { id: "request-3", responseRevision: 4, at: revisedAt });

    const concurrentResults = await Promise.all([
      processDiagnosisBrainProjectionRequest(db, "request-2", revisedAt),
      processDiagnosisBrainProjectionRequest(db, "request-3", revisedAt),
    ]);
    expect(concurrentResults.reduce((sum, result) => sum + result.applied, 0)).toBe(1);
    expect(concurrentResults.reduce((sum, result) => sum + result.failed, 0)).toBe(1);

    const itemsAfterConflict = await db.select().from(schema.brainItems);
    expect(itemsAfterConflict).toHaveLength(2);
    expect(itemsAfterConflict.filter(({ status }) => status === "active")).toHaveLength(1);
    expect(await db.select().from(schema.brainItemRevisions)).toHaveLength(1);

    await processPendingDiagnosisBrainProjections(db, {
      at: new Date(revisedAt.getTime() + 5 * 60 * 1000),
    });

    const items = await db.select().from(schema.brainItems);
    expect(items).toHaveLength(2);
    expect(items.filter(({ status }) => status === "active")).toHaveLength(1);
    expect(items.filter(({ status }) => status === "superseded")).toHaveLength(1);
    expect(await db.select().from(schema.brainItemRevisions)).toHaveLength(1);
    expect(await db.select().from(schema.diagnosisBrainProjectionHeads)).toHaveLength(1);
    expect(
      await db
        .select({ status: schema.diagnosisBrainProjectionRequests.status })
        .from(schema.diagnosisBrainProjectionRequests),
    ).toEqual([{ status: "applied" }, { status: "applied" }, { status: "applied" }]);
  });

  it("不正な採点設定はterminalなskipとして完了し再試行しない", async () => {
    const db = createTestDb();
    const at = await insertFixture(db, true);
    const storedConfig = await db
      .select({ definition: schema.diagnosisScoringConfigs.definition })
      .from(schema.diagnosisScoringConfigs)
      .get();
    await db
      .update(schema.diagnosisScoringConfigs)
      .set({
        definition: {
          ...(storedConfig?.definition as Record<string, unknown>),
          minimumCoverage: 2,
        },
      })
      .where(eq(schema.diagnosisScoringConfigs.id, "scoring-1"));

    await expect(processDiagnosisBrainProjectionRequest(db, "request-1", at)).resolves.toEqual({
      processed: 1,
      applied: 0,
      skippedIncomplete: 0,
      skippedInvalidConfig: 1,
      failed: 0,
    });
    expect(await db.select().from(schema.brainItems)).toHaveLength(0);
    await expect(
      processPendingDiagnosisBrainProjections(db, {
        at: new Date(at.getTime() + 5 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ processed: 0 });
  });
});
