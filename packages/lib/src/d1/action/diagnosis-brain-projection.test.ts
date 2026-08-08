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
  processPendingDiagnosisBrainProjections,
} from "./diagnosis-brain-projection";

function createTestDb(): D1Client {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  Object.assign(db, {
    batch: async (queries: Array<PromiseLike<unknown>>) => {
      const results: unknown[] = [];
      for (const query of queries) results.push(await query);
      return results;
    },
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

describe("Diagnosis Brain projection", () => {
  it("回答済み診断からpendingのBrain ItemとEvidenceを作る", async () => {
    const db = createTestDb();
    const at = await insertFixture(db, true);

    await expect(processDiagnosisBrainProjectionRequest(db, "request-1", at)).resolves.toEqual({
      processed: 1,
      applied: 1,
      skippedIncomplete: 0,
      failed: 0,
    });
    expect(await db.select().from(schema.brainItems)).toEqual([
      expect.objectContaining({
        accountId: "account-1",
        category: "preference",
        statement: "計画性は「計画的」の傾向がある",
        derivation: "deterministic",
        confirmation: "pending",
        status: "active",
      }),
    ]);
    expect(await db.select().from(schema.brainItemEvidenceEdges)).toHaveLength(2);
    expect(await db.select().from(schema.brainItemAccessLabels)).toEqual([
      expect.objectContaining({
        accountId: "account-1",
        label: "unclassified",
        confirmation: "pending",
        assignedBy: "system",
      }),
    ]);
    expect(
      await db
        .select({ status: schema.diagnosisBrainProjectionRequests.status })
        .from(schema.diagnosisBrainProjectionRequests)
        .where(eq(schema.diagnosisBrainProjectionRequests.id, "request-1"))
        .get(),
    ).toEqual({ status: "applied" });
  });

  it("回答途中ならItemを作らず正常終了する", async () => {
    const db = createTestDb();
    const at = await insertFixture(db, false);

    await expect(processPendingDiagnosisBrainProjections(db, { at })).resolves.toEqual({
      processed: 1,
      applied: 0,
      skippedIncomplete: 1,
      failed: 0,
    });
    expect(await db.select().from(schema.brainItems)).toHaveLength(0);
  });
});
