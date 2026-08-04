import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import { findOpenSurveyDetail, listVisibleSurveys } from "./questionnaire";

function createTestDb(): D1Client {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  return db as unknown as D1Client;
}

async function insertQuestion(db: D1Client, id: string) {
  await db.insert(schema.questions).values({ id });
  await db.insert(schema.questionVersions).values({
    questionId: id,
    version: 1,
    state: "approved",
    text: `${id}の質問`,
    format: "single_choice",
    approvedAt: new Date("2026-08-01T00:00:00Z"),
  });
  await db.insert(schema.questionChoices).values([
    { questionId: id, questionVersion: 1, choiceId: "no", label: "いいえ", position: 0 },
    { questionId: id, questionVersion: 1, choiceId: "yes", label: "はい", position: 1 },
  ]);
}

async function insertSurvey(
  db: D1Client,
  input: {
    id: string;
    state?: "draft" | "published" | "withdrawn";
    opensAt?: Date;
    closesAt?: Date;
  },
) {
  const questionIds = [`${input.id}-q1`, `${input.id}-q2`];
  for (const questionId of questionIds) {
    await insertQuestion(db, questionId);
  }
  await db.insert(schema.surveys).values({
    id: input.id,
    title: `${input.id} title`,
    description: `${input.id} description`,
    opensAt: input.opensAt ?? new Date("2026-08-01T00:00:00Z"),
    ...(input.closesAt ? { closesAt: input.closesAt } : {}),
    state: input.state ?? "published",
    publishedAt: new Date("2026-08-01T00:00:00Z"),
  });
  await db.insert(schema.surveyQuestions).values(
    questionIds.map((questionId, position) => ({
      id: `${input.id}-sq${position + 1}`,
      surveyId: input.id,
      questionId,
      questionVersion: 1,
      position,
    })),
  );
}

describe("listVisibleSurveys", () => {
  it("公開済み・受付開始後だけを一覧へ返し、受付終了を区別する", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-1" });
    await insertSurvey(db, { id: "open" });
    await insertSurvey(db, {
      id: "closed",
      closesAt: new Date("2026-08-02T00:00:00Z"),
    });
    await insertSurvey(db, {
      id: "before-open",
      opensAt: new Date("2026-08-04T00:00:00Z"),
    });
    await insertSurvey(db, { id: "withdrawn", state: "withdrawn" });

    const result = await listVisibleSurveys(db, "account-1", new Date("2026-08-03T00:00:00Z"));

    expect(result.map(({ id }) => id)).toEqual(["closed", "open"]);
    expect(result).toEqual([
      expect.objectContaining({
        id: "closed",
        description: "closed description",
        availability: "closed",
        responseStatus: "unanswered",
        answeredCount: 0,
        questionCount: 2,
      }),
      expect.objectContaining({ id: "open", availability: "open" }),
    ]);
  });

  it("本人の現在有効なAnswer数から回答状態を導出する", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values([{ id: "account-1" }, { id: "account-2" }]);
    await insertSurvey(db, { id: "survey-a" });
    await insertSurvey(db, { id: "survey-b" });
    await db.insert(schema.surveyResponses).values([
      { id: "response-a", accountId: "account-1", surveyId: "survey-a" },
      { id: "response-b", accountId: "account-1", surveyId: "survey-b" },
      { id: "response-other", accountId: "account-2", surveyId: "survey-a" },
    ]);
    await db.insert(schema.sourceRecords).values([
      { id: "source-a1", accountId: "account-1", kind: "user_input" },
      { id: "source-b1", accountId: "account-1", kind: "user_input" },
      { id: "source-b2", accountId: "account-1", kind: "user_input" },
      { id: "source-other", accountId: "account-2", kind: "user_input" },
    ]);
    await db.insert(schema.surveyAnswers).values([
      {
        id: "answer-a1",
        surveyResponseId: "response-a",
        surveyQuestionId: "survey-a-sq1",
        questionId: "survey-a-q1",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: new Date("2026-08-02T00:00:00Z"),
        sourceRecordId: "source-a1",
      },
      {
        id: "answer-b1",
        surveyResponseId: "response-b",
        surveyQuestionId: "survey-b-sq1",
        questionId: "survey-b-q1",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: new Date("2026-08-02T00:00:00Z"),
        sourceRecordId: "source-b1",
      },
      {
        id: "answer-b2",
        surveyResponseId: "response-b",
        surveyQuestionId: "survey-b-sq2",
        questionId: "survey-b-q2",
        questionVersion: 1,
        choiceId: "no",
        acceptedAt: new Date("2026-08-02T00:00:00Z"),
        sourceRecordId: "source-b2",
      },
      {
        id: "answer-other",
        surveyResponseId: "response-other",
        surveyQuestionId: "survey-a-sq2",
        questionId: "survey-a-q2",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: new Date("2026-08-02T00:00:00Z"),
        sourceRecordId: "source-other",
      },
    ]);

    const result = await listVisibleSurveys(db, "account-1", new Date("2026-08-03T00:00:00Z"));

    expect(result.find(({ id }) => id === "survey-a")).toMatchObject({
      responseStatus: "in-progress",
      answeredCount: 1,
      questionCount: 2,
    });
    expect(result.find(({ id }) => id === "survey-b")).toMatchObject({
      responseStatus: "answered",
      answeredCount: 2,
      questionCount: 2,
    });
  });
});

describe("findOpenSurveyDetail", () => {
  it("Surveyが固定したQuestion VersionとChoiceを位置順に返す", async () => {
    const db = createTestDb();
    await insertSurvey(db, { id: "survey-detail" });

    const result = await findOpenSurveyDetail(
      db,
      "survey-detail",
      new Date("2026-08-03T00:00:00Z"),
    );

    expect(result).toEqual({
      type: "found",
      survey: expect.objectContaining({
        id: "survey-detail",
        questions: [
          expect.objectContaining({
            surveyQuestionId: "survey-detail-sq1",
            questionId: "survey-detail-q1",
            questionVersion: 1,
            text: "survey-detail-q1の質問",
            choices: [
              { choiceId: "no", label: "いいえ", presentation: {} },
              { choiceId: "yes", label: "はい", presentation: {} },
            ],
          }),
          expect.objectContaining({ surveyQuestionId: "survey-detail-sq2" }),
        ],
      }),
    });
  });

  it.each([
    { id: "missing", setup: undefined },
    { id: "draft", setup: { id: "draft", state: "draft" as const } },
    {
      id: "before-open",
      setup: { id: "before-open", opensAt: new Date("2026-08-04T00:00:00Z") },
    },
    { id: "withdrawn", setup: { id: "withdrawn", state: "withdrawn" as const } },
  ])("存在しない・非公開状態をnot-foundへ寄せる: $id", async ({ id, setup }) => {
    const db = createTestDb();
    if (setup) {
      await insertSurvey(db, setup);
    }

    await expect(findOpenSurveyDetail(db, id, new Date("2026-08-03T00:00:00Z"))).resolves.toEqual({
      type: "not-found",
    });
  });

  it("受付終了をclosedとして区別する", async () => {
    const db = createTestDb();
    await insertSurvey(db, {
      id: "closed-detail",
      closesAt: new Date("2026-08-02T00:00:00Z"),
    });

    await expect(
      findOpenSurveyDetail(db, "closed-detail", new Date("2026-08-03T00:00:00Z")),
    ).resolves.toEqual({ type: "closed" });
  });
});
