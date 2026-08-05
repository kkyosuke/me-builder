import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "./index";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  return db;
}

function insertFixture() {
  const db = createTestDb();
  const opensAt = new Date("2026-08-01T00:00:00Z");

  db.insert(schema.accounts).values({ id: "account-1" }).run();
  db.insert(schema.questions).values({ id: "question-1" }).run();
  db.insert(schema.questionVersions)
    .values({
      questionId: "question-1",
      version: 1,
      state: "approved",
      text: "どちらですか？",
      format: "single_choice",
      approvedAt: opensAt,
    })
    .run();
  db.insert(schema.questionChoices)
    .values([
      {
        questionId: "question-1",
        questionVersion: 1,
        choiceId: "left",
        label: "左",
        position: 0,
      },
      {
        questionId: "question-1",
        questionVersion: 1,
        choiceId: "right",
        label: "右",
        position: 1,
      },
    ])
    .run();
  db.insert(schema.diagnoses)
    .values({
      id: "diagnosis-1",
      title: "診断",
      description: "診断の説明",
      opensAt,
      state: "published",
      publishedAt: opensAt,
    })
    .run();
  db.insert(schema.diagnosisQuestions)
    .values({
      id: "diagnosis-question-1",
      diagnosisId: "diagnosis-1",
      questionId: "question-1",
      questionVersion: 1,
      position: 0,
    })
    .run();
  db.insert(schema.diagnosisResponses)
    .values({ id: "response-1", accountId: "account-1", diagnosisId: "diagnosis-1" })
    .run();
  db.insert(schema.sourceRecords)
    .values({ id: "source-1", accountId: "account-1", kind: "user_input" })
    .run();

  return { db, opensAt };
}

describe("Diagnosis D1 schema", () => {
  it("AccountとDiagnosisの有効なResponseを1件に制限する", () => {
    const { db } = insertFixture();

    expect(() =>
      db
        .insert(schema.diagnosisResponses)
        .values({ id: "response-2", accountId: "account-1", diagnosisId: "diagnosis-1" })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("Answerが参照するChoiceをQuestion Versionとの組み合わせで検証する", () => {
    const { db, opensAt } = insertFixture();

    expect(() =>
      db
        .insert(schema.diagnosisAnswers)
        .values({
          id: "answer-invalid",
          diagnosisResponseId: "response-1",
          diagnosisQuestionId: "diagnosis-question-1",
          questionId: "question-1",
          questionVersion: 1,
          choiceId: "missing",
          acceptedAt: opensAt,
          sourceRecordId: "source-invalid",
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);

    db.insert(schema.diagnosisAnswers)
      .values({
        id: "answer-1",
        diagnosisResponseId: "response-1",
        diagnosisQuestionId: "diagnosis-question-1",
        questionId: "question-1",
        questionVersion: 1,
        choiceId: "left",
        acceptedAt: opensAt,
        sourceRecordId: "source-1",
      })
      .run();

    expect(db.select().from(schema.diagnosisAnswers).all()).toHaveLength(1);
  });
});
