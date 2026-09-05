import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { LIKERT_5_LABELS, LIKERT_5_SCORES } from "../../../diagnosis/question-format";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { findOpenDiagnosisDetail } from "./catalog";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  return db as unknown as SharedD1Client;
}

async function insertQuestion(db: SharedD1Client, id: string) {
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

async function insertDiagnosis(
  db: SharedD1Client,
  input: {
    id: string;
    state?: "draft" | "published" | "withdrawn";
    opensAt?: Date;
    closesAt?: Date;
    scoringConfigId?: string;
    displayOrder?: number;
  },
) {
  const questionIds = [`${input.id}-q1`, `${input.id}-q2`];
  for (const questionId of questionIds) {
    await insertQuestion(db, questionId);
  }
  await db.insert(schema.diagnoses).values({
    id: input.id,
    title: `${input.id} title`,
    description: `${input.id} description`,
    ...(input.scoringConfigId ? { scoringConfigId: input.scoringConfigId } : {}),
    displayOrder: input.displayOrder ?? 0,
    opensAt: input.opensAt ?? new Date("2026-08-01T00:00:00Z"),
    ...(input.closesAt ? { closesAt: input.closesAt } : {}),
    state: input.state ?? "published",
    publishedAt: new Date("2026-08-01T00:00:00Z"),
  });
  await db.insert(schema.diagnosisQuestions).values(
    questionIds.map((questionId, position) => ({
      id: `${input.id}-sq${position + 1}`,
      diagnosisId: input.id,
      questionId,
      questionVersion: 1,
      position,
    })),
  );
}

async function changeQuestionToLikert5(db: SharedD1Client, questionId: string) {
  await db
    .update(schema.questionVersions)
    .set({ format: "likert_5" })
    .where(eq(schema.questionVersions.questionId, questionId));
  await db.delete(schema.questionChoices).where(eq(schema.questionChoices.questionId, questionId));
  await db.insert(schema.questionChoices).values(
    LIKERT_5_LABELS.map((label, position) => ({
      questionId,
      questionVersion: 1,
      choiceId: `level-${position + 1}`,
      label,
      position,
    })),
  );
}

describe("findOpenDiagnosisDetail", () => {
  it("Diagnosisが固定したQuestion VersionとChoiceを位置順に返す", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, { id: "diagnosis-detail" });

    const result = await findOpenDiagnosisDetail(
      db,
      "diagnosis-detail",
      new Date("2026-08-03T00:00:00Z"),
    );

    expect(result).toEqual({
      type: "found",
      diagnosis: expect.objectContaining({
        id: "diagnosis-detail",
        questions: [
          expect.objectContaining({
            diagnosisQuestionId: "diagnosis-detail-sq1",
            questionId: "diagnosis-detail-q1",
            questionVersion: 1,
            text: "diagnosis-detail-q1の質問",
            format: "single_choice",
            choices: [
              { choiceId: "no", label: "いいえ", score: null },
              { choiceId: "yes", label: "はい", score: null },
            ],
          }),
          expect.objectContaining({ diagnosisQuestionId: "diagnosis-detail-sq2" }),
        ],
      }),
    });
  });

  it("直前の2択を参照する質問をカードの裏面として返す", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, { id: "paired-detail" });
    await db
      .update(schema.diagnosisQuestions)
      .set({ backsideOfDiagnosisQuestionId: "paired-detail-sq1" })
      .where(eq(schema.diagnosisQuestions.id, "paired-detail-sq2"));

    const result = await findOpenDiagnosisDetail(
      db,
      "paired-detail",
      new Date("2026-08-03T00:00:00Z"),
    );

    expect(result).toMatchObject({
      type: "found",
      diagnosis: {
        questions: [
          { diagnosisQuestionId: "paired-detail-sq1", backsideOfDiagnosisQuestionId: null },
          {
            diagnosisQuestionId: "paired-detail-sq2",
            backsideOfDiagnosisQuestionId: "paired-detail-sq1",
          },
        ],
      },
    });
  });

  it("直前の表面以外を参照する裏面をpublished catalogから返さない", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, { id: "invalid-paired-detail" });
    await db
      .update(schema.diagnosisQuestions)
      .set({ backsideOfDiagnosisQuestionId: "invalid-paired-detail-sq2" })
      .where(eq(schema.diagnosisQuestions.id, "invalid-paired-detail-sq1"));

    await expect(
      findOpenDiagnosisDetail(db, "invalid-paired-detail", new Date("2026-08-03T00:00:00Z")),
    ).rejects.toThrow(
      "Published diagnosis backside must immediately follow a standalone single-choice front",
    );
  });

  it("未設計の回答形式をpublished catalogから返さない", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, { id: "unsupported-format" });
    await db
      .update(schema.questionVersions)
      .set({ format: "free_text" as never })
      .where(eq(schema.questionVersions.questionId, "unsupported-format-q1"));

    await expect(
      findOpenDiagnosisDetail(db, "unsupported-format", new Date("2026-08-03T00:00:00Z")),
    ).rejects.toThrow("Unsupported diagnosis question format in published catalog");
  });

  it("2択でないsingle choiceをpublished catalogから返さない", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, { id: "malformed-single-choice" });
    await db
      .delete(schema.questionChoices)
      .where(
        and(
          eq(schema.questionChoices.questionId, "malformed-single-choice-q1"),
          eq(schema.questionChoices.choiceId, "yes"),
        ),
      );

    await expect(
      findOpenDiagnosisDetail(db, "malformed-single-choice", new Date("2026-08-03T00:00:00Z")),
    ).rejects.toThrow("Published single-choice diagnosis question must have exactly two choices");
  });

  it("固定した5段階の文言とscoreを位置順に返す", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, { id: "likert-detail" });
    await changeQuestionToLikert5(db, "likert-detail-q1");
    await changeQuestionToLikert5(db, "likert-detail-q2");

    const result = await findOpenDiagnosisDetail(
      db,
      "likert-detail",
      new Date("2026-08-03T00:00:00Z"),
    );

    expect(result).toMatchObject({
      type: "found",
      diagnosis: {
        questions: [
          {
            format: "likert_5",
            choices: LIKERT_5_LABELS.map((label, position) => ({
              choiceId: `level-${position + 1}`,
              label,
              score: LIKERT_5_SCORES[position],
            })),
          },
          { format: "likert_5" },
        ],
      },
    });
  });

  it("1つのDiagnosisへ2択と5段階を混在させない", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, { id: "mixed-format" });
    await changeQuestionToLikert5(db, "mixed-format-q2");

    await expect(
      findOpenDiagnosisDetail(db, "mixed-format", new Date("2026-08-03T00:00:00Z")),
    ).rejects.toThrow("Published diagnosis must not mix question formats");
  });

  it("5段階の固定文言が崩れたcatalogを返さない", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, { id: "malformed-likert" });
    await changeQuestionToLikert5(db, "malformed-likert-q1");
    await changeQuestionToLikert5(db, "malformed-likert-q2");
    await db
      .update(schema.questionChoices)
      .set({ label: "独自ラベル" })
      .where(
        and(
          eq(schema.questionChoices.questionId, "malformed-likert-q1"),
          eq(schema.questionChoices.choiceId, "level-3"),
        ),
      );

    await expect(
      findOpenDiagnosisDetail(db, "malformed-likert", new Date("2026-08-03T00:00:00Z")),
    ).rejects.toThrow("Published likert-5 diagnosis question must use the fixed five choices");
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
      await insertDiagnosis(db, setup);
    }

    await expect(
      findOpenDiagnosisDetail(db, id, new Date("2026-08-03T00:00:00Z")),
    ).resolves.toEqual({
      type: "not-found",
    });
  });

  it("受付終了をclosedとして区別する", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, {
      id: "closed-detail",
      closesAt: new Date("2026-08-02T00:00:00Z"),
    });

    await expect(
      findOpenDiagnosisDetail(db, "closed-detail", new Date("2026-08-03T00:00:00Z")),
    ).resolves.toEqual({ type: "closed" });
  });

  it("回答者向けの場合だけwithdrawnの固定済みQuestion Versionを返す", async () => {
    const db = createTestDb();
    await insertDiagnosis(db, { id: "withdrawn-detail", state: "withdrawn" });
    const at = new Date("2026-08-03T00:00:00Z");

    await expect(findOpenDiagnosisDetail(db, "withdrawn-detail", at)).resolves.toEqual({
      type: "not-found",
    });
    await expect(
      findOpenDiagnosisDetail(db, "withdrawn-detail", at, { allowWithdrawn: true }),
    ).resolves.toEqual({
      type: "found",
      diagnosis: expect.objectContaining({ id: "withdrawn-detail" }),
    });
  });
});
