import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
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
            choices: [
              { choiceId: "no", label: "いいえ" },
              { choiceId: "yes", label: "はい" },
            ],
          }),
          expect.objectContaining({ diagnosisQuestionId: "diagnosis-detail-sq2" }),
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
});
