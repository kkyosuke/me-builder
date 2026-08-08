import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import {
  deferDiagnosisQuestion,
  deleteAccountDiagnosisData,
  findDiagnosisAnswers,
  findOpenDiagnosisDetail,
  listVisibleDiagnoses,
  saveDiagnosisAnswer,
} from "./diagnosis";

describe("deferDiagnosisQuestion", () => {
  it("未回答の質問を保存し、再送時は初回の時刻を保つ", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "defer-account" });
    await insertDiagnosis(db, { id: "defer-target" });
    const input = {
      accountId: "defer-account",
      diagnosisId: "defer-target",
      diagnosisQuestionId: "defer-target-sq1",
      at: new Date("2026-08-06T00:00:00.987Z"),
    };

    await expect(deferDiagnosisQuestion(db, input)).resolves.toEqual({
      type: "deferred",
      outcome: "created",
      deferredQuestion: {
        diagnosisQuestionId: "defer-target-sq1",
        deferredAt: "2026-08-06T00:00:00.000Z",
      },
    });
    await expect(
      deferDiagnosisQuestion(db, { ...input, at: new Date("2026-08-06T01:00:00Z") }),
    ).resolves.toEqual({
      type: "deferred",
      outcome: "unchanged",
      deferredQuestion: {
        diagnosisQuestionId: "defer-target-sq1",
        deferredAt: "2026-08-06T00:00:00.000Z",
      },
    });

    const records = await db.select().from(schema.diagnosisDeferredQuestions);
    expect(records).toHaveLength(1);
  });

  it("回答済みの質問は延期せず、回答保存は既存の延期を解消する", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "defer-answer-account" });
    await insertDiagnosis(db, { id: "defer-answer-target" });
    const base = {
      accountId: "defer-answer-account",
      diagnosisId: "defer-answer-target",
      diagnosisQuestionId: "defer-answer-target-sq1",
      at: new Date("2026-08-06T00:00:00Z"),
    };

    await deferDiagnosisQuestion(db, base);
    await saveDiagnosisAnswer(db, { ...base, choiceId: "yes" });
    await expect(
      deferDiagnosisQuestion(db, { ...base, at: new Date("2026-08-06T01:00:00Z") }),
    ).resolves.toEqual({ type: "question-already-answered" });

    const active = await db
      .select()
      .from(schema.diagnosisDeferredQuestions)
      .where(eq(schema.diagnosisDeferredQuestions.isDeleted, false));
    expect(active).toHaveLength(0);
  });

  it("公開状態・受付期間・Diagnosis Questionを検証する", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "defer-validation-account" });
    await insertDiagnosis(db, {
      id: "defer-closed",
      closesAt: new Date("2026-08-05T00:00:00Z"),
    });
    const base = {
      accountId: "defer-validation-account",
      diagnosisId: "defer-closed",
      diagnosisQuestionId: "defer-closed-sq1",
      at: new Date("2026-08-06T00:00:00Z"),
    };

    await expect(deferDiagnosisQuestion(db, base)).resolves.toEqual({
      type: "diagnosis-closed",
    });
    await expect(
      deferDiagnosisQuestion(db, {
        ...base,
        diagnosisId: "missing",
      }),
    ).resolves.toEqual({ type: "diagnosis-not-found" });
    await expect(
      deferDiagnosisQuestion(db, {
        ...base,
        diagnosisId: "defer-closed",
        diagnosisQuestionId: "missing",
        at: new Date("2026-08-04T00:00:00Z"),
      }),
    ).resolves.toEqual({ type: "diagnosis-question-not-found" });
  });
});

type DbExecutionObserver = {
  onBatch?: () => void;
  onQuery?: (insideBatch: boolean) => void;
};

function createTestDb(observer?: DbExecutionObserver): D1Client {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  let batchDepth = 0;
  const db = drizzle(sqlite, {
    schema,
    ...(observer?.onQuery
      ? {
          logger: {
            logQuery: () => observer.onQuery?.(batchDepth > 0),
          },
        }
      : {}),
  });
  Object.assign(db, {
    batch: async (queries: Array<PromiseLike<unknown>>) => {
      observer?.onBatch?.();
      batchDepth += 1;
      try {
        const results: unknown[] = [];
        for (const query of queries) {
          results.push(await query);
        }
        return results;
      } finally {
        batchDepth -= 1;
      }
    },
  });
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

async function insertDiagnosis(
  db: D1Client,
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

describe("listVisibleDiagnoses", () => {
  it("公開済み・受付開始後だけを一覧へ返し、受付終了を区別する", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-1" });
    await insertDiagnosis(db, { id: "open", displayOrder: 20 });
    await insertDiagnosis(db, {
      id: "closed",
      closesAt: new Date("2026-08-02T00:00:00Z"),
      displayOrder: 10,
    });
    await insertDiagnosis(db, {
      id: "before-open",
      opensAt: new Date("2026-08-04T00:00:00Z"),
    });
    await insertDiagnosis(db, { id: "withdrawn", state: "withdrawn" });

    const result = await listVisibleDiagnoses(db, "account-1", new Date("2026-08-03T00:00:00Z"));

    expect(result.map(({ id }) => id)).toEqual(["closed", "open"]);
    expect(result).toEqual([
      expect.objectContaining({
        id: "closed",
        description: "closed description",
        displayOrder: 10,
        availability: "closed",
        responseStatus: "unanswered",
        answeredCount: 0,
        questionCount: 2,
        lastAnsweredAt: null,
      }),
      expect.objectContaining({ id: "open", availability: "open" }),
    ]);
  });

  it("本人の現在有効なAnswer数から回答状態を導出する", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values([{ id: "account-1" }, { id: "account-2" }]);
    await insertDiagnosis(db, { id: "diagnosis-a" });
    await insertDiagnosis(db, { id: "diagnosis-b" });
    await db.insert(schema.diagnosisResponses).values([
      { id: "response-a", accountId: "account-1", diagnosisId: "diagnosis-a" },
      { id: "response-b", accountId: "account-1", diagnosisId: "diagnosis-b" },
      { id: "response-other", accountId: "account-2", diagnosisId: "diagnosis-a" },
    ]);
    await db.insert(schema.sourceRecords).values([
      { id: "source-a1", accountId: "account-1", kind: "user_input" },
      { id: "source-b1", accountId: "account-1", kind: "user_input" },
      { id: "source-b2", accountId: "account-1", kind: "user_input" },
      { id: "source-other", accountId: "account-2", kind: "user_input" },
    ]);
    await db.insert(schema.diagnosisAnswers).values([
      {
        id: "answer-a1",
        accountId: "account-1",
        diagnosisResponseId: "response-a",
        diagnosisQuestionId: "diagnosis-a-sq1",
        questionId: "diagnosis-a-q1",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: new Date("2026-08-02T00:00:00Z"),
        sourceRecordId: "source-a1",
      },
      {
        id: "answer-b1",
        accountId: "account-1",
        diagnosisResponseId: "response-b",
        diagnosisQuestionId: "diagnosis-b-sq1",
        questionId: "diagnosis-b-q1",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: new Date("2026-08-02T00:00:00Z"),
        sourceRecordId: "source-b1",
      },
      {
        id: "answer-b2",
        accountId: "account-1",
        diagnosisResponseId: "response-b",
        diagnosisQuestionId: "diagnosis-b-sq2",
        questionId: "diagnosis-b-q2",
        questionVersion: 1,
        choiceId: "no",
        acceptedAt: new Date("2026-08-02T12:00:00Z"),
        sourceRecordId: "source-b2",
      },
      {
        id: "answer-other",
        accountId: "account-2",
        diagnosisResponseId: "response-other",
        diagnosisQuestionId: "diagnosis-a-sq2",
        questionId: "diagnosis-a-q2",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: new Date("2026-08-02T00:00:00Z"),
        sourceRecordId: "source-other",
      },
    ]);

    const result = await listVisibleDiagnoses(db, "account-1", new Date("2026-08-03T00:00:00Z"));

    expect(result.find(({ id }) => id === "diagnosis-a")).toMatchObject({
      responseStatus: "in-progress",
      answeredCount: 1,
      questionCount: 2,
      lastAnsweredAt: "2026-08-02T00:00:00.000Z",
    });
    expect(result.find(({ id }) => id === "diagnosis-b")).toMatchObject({
      responseStatus: "answered",
      answeredCount: 2,
      questionCount: 2,
      lastAnsweredAt: "2026-08-02T12:00:00.000Z",
    });
  });
});

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

describe("findDiagnosisAnswers", () => {
  it("受付終了後も本人の回答とDiagnosisが固定した採点設定を返す", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-result" });
    const scoringDefinition = {
      parameters: [{ id: "parameter", label: "項目" }],
      choiceScores: { yes: 1, no: -1 },
    };
    await db.insert(schema.diagnosisScoringConfigs).values({
      id: "result-scoring-v2",
      version: 2,
      definition: scoringDefinition,
    });
    await insertDiagnosis(db, {
      id: "result-target",
      closesAt: new Date("2026-08-04T00:00:00Z"),
      scoringConfigId: "result-scoring-v2",
    });
    const base = {
      accountId: "account-result",
      diagnosisId: "result-target",
      choiceId: "yes",
      at: new Date("2026-08-03T00:00:00Z"),
    };
    await saveDiagnosisAnswer(db, { ...base, diagnosisQuestionId: "result-target-sq2" });
    await saveDiagnosisAnswer(db, {
      ...base,
      diagnosisQuestionId: "result-target-sq1",
      choiceId: "no",
    });

    const result = await findDiagnosisAnswers(
      db,
      "account-result",
      "result-target",
      new Date("2026-08-05T00:00:00Z"),
    );

    expect(result).toEqual({
      type: "found",
      diagnosis: expect.objectContaining({
        id: "result-target",
        responseStatus: "answered",
        answeredCount: 2,
        questionCount: 2,
        scoringConfig: {
          id: "result-scoring-v2",
          version: 2,
          definition: scoringDefinition,
          questions: [
            {
              questionId: "result-target-q1",
              questionVersion: 1,
              choiceIds: ["no", "yes"],
            },
            {
              questionId: "result-target-q2",
              questionVersion: 1,
              choiceIds: ["no", "yes"],
            },
          ],
        },
        answers: [
          expect.objectContaining({
            diagnosisQuestionId: "result-target-sq1",
            questionText: "result-target-q1の質問",
            choiceId: "no",
            choiceLabel: "いいえ",
          }),
          expect.objectContaining({
            diagnosisQuestionId: "result-target-sq2",
            choiceId: "yes",
            choiceLabel: "はい",
          }),
        ],
      }),
    });
  });

  it("本人の回答がない場合はnot-foundを返す", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values([{ id: "owner" }, { id: "another" }]);
    await insertDiagnosis(db, { id: "private-result" });
    await saveDiagnosisAnswer(db, {
      accountId: "owner",
      diagnosisId: "private-result",
      diagnosisQuestionId: "private-result-sq1",
      choiceId: "yes",
      at: new Date("2026-08-03T00:00:00Z"),
    });

    await expect(
      findDiagnosisAnswers(db, "another", "private-result", new Date("2026-08-03T00:00:00Z")),
    ).resolves.toEqual({ type: "not-found" });
  });
});

describe("deleteAccountDiagnosisData", () => {
  it("本人の回答由来データだけを物理削除し、定義・他人・無関係なSourceを残す", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values([{ id: "reset-owner" }, { id: "reset-other" }]);
    await insertDiagnosis(db, { id: "reset-target" });
    const base = {
      diagnosisId: "reset-target",
      diagnosisQuestionId: "reset-target-sq1",
      choiceId: "yes",
      at: new Date("2026-08-03T00:00:00Z"),
    };
    await saveDiagnosisAnswer(db, { ...base, accountId: "reset-owner" });
    await saveDiagnosisAnswer(db, { ...base, accountId: "reset-other" });

    const ownerResponse = await db
      .select({ id: schema.diagnosisResponses.id })
      .from(schema.diagnosisResponses)
      .where(eq(schema.diagnosisResponses.accountId, "reset-owner"))
      .get();
    const ownerAnswer = await db
      .select({ sourceRecordId: schema.diagnosisAnswers.sourceRecordId })
      .from(schema.diagnosisAnswers)
      .where(eq(schema.diagnosisAnswers.diagnosisResponseId, ownerResponse?.id ?? ""))
      .get();
    expect(ownerResponse).toBeTruthy();
    expect(ownerAnswer).toBeTruthy();

    await db.insert(schema.diagnosisDeferredQuestions).values({
      id: "reset-deferred",
      accountId: "reset-owner",
      diagnosisResponseId: ownerResponse?.id ?? "",
      diagnosisQuestionId: "reset-target-sq2",
      deferredAt: new Date("2026-08-03T00:01:00Z"),
    });
    await db.insert(schema.sourceRecords).values({
      id: "unrelated-source",
      accountId: "reset-owner",
      kind: "user_input",
    });
    await db.insert(schema.sourceRecordRevisions).values({
      id: "answer-revision",
      accountId: "reset-owner",
      previousSourceRecordId: ownerAnswer?.sourceRecordId ?? "",
      nextSourceRecordId: "unrelated-source",
      derivationMethod: "deterministic",
    });

    await expect(deleteAccountDiagnosisData(db, "reset-owner")).resolves.toEqual({
      deletedResponseCount: 1,
      deletedAnswerCount: 1,
      deletedDeferredQuestionCount: 1,
      deletedSourceRecordCount: 1,
    });

    expect(await db.select().from(schema.diagnoses)).toHaveLength(1);
    expect(await db.select().from(schema.accounts)).toHaveLength(2);
    expect(await db.select().from(schema.diagnosisResponses)).toMatchObject([
      { accountId: "reset-other" },
    ]);
    expect(await db.select().from(schema.diagnosisAnswers)).toHaveLength(1);
    expect(await db.select().from(schema.diagnosisDeferredQuestions)).toHaveLength(0);
    expect(await db.select().from(schema.sourceRecords)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "unrelated-source", accountId: "reset-owner" }),
        expect.objectContaining({ accountId: "reset-other" }),
      ]),
    );
    expect(await db.select().from(schema.sourceRecordRevisions)).toHaveLength(0);

    await expect(deleteAccountDiagnosisData(db, "reset-owner")).resolves.toEqual({
      deletedResponseCount: 0,
      deletedAnswerCount: 0,
      deletedDeferredQuestionCount: 0,
      deletedSourceRecordCount: 0,
    });
  });

  it("削除対象の抽出を含む全SQLを1回のatomic batch内で実行する", async () => {
    let tracking = false;
    let batchCount = 0;
    const queryContexts: boolean[] = [];
    const db = createTestDb({
      onBatch: () => {
        if (tracking) {
          batchCount += 1;
        }
      },
      onQuery: (insideBatch) => {
        if (tracking) {
          queryContexts.push(insideBatch);
        }
      },
    });
    await db.insert(schema.accounts).values({ id: "atomic-reset-owner" });
    await insertDiagnosis(db, { id: "atomic-reset-target" });
    await saveDiagnosisAnswer(db, {
      accountId: "atomic-reset-owner",
      diagnosisId: "atomic-reset-target",
      diagnosisQuestionId: "atomic-reset-target-sq1",
      choiceId: "yes",
      at: new Date("2026-08-03T00:00:00Z"),
    });

    tracking = true;
    await deleteAccountDiagnosisData(db, "atomic-reset-owner");

    expect(batchCount).toBe(1);
    expect(queryContexts.length).toBeGreaterThan(0);
    expect(queryContexts.every((insideBatch) => insideBatch)).toBe(true);
  });
});

describe("saveDiagnosisAnswer", () => {
  it("初回回答でDiagnosisResponse・Source Record・Answerを作成し進捗を返す", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-save" });
    await insertDiagnosis(db, { id: "save-target" });
    const at = new Date("2026-08-03T00:00:00Z");

    const result = await saveDiagnosisAnswer(db, {
      accountId: "account-save",
      diagnosisId: "save-target",
      diagnosisQuestionId: "save-target-sq1",
      choiceId: "yes",
      at,
    });

    expect(result).toMatchObject({
      type: "saved",
      outcome: "created",
      answer: {
        diagnosisQuestionId: "save-target-sq1",
        questionId: "save-target-q1",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: at.toISOString(),
      },
      progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 2 },
    });
    expect(await db.select().from(schema.diagnosisResponses)).toHaveLength(1);
    expect(await db.select().from(schema.sourceRecords)).toMatchObject([
      { accountId: "account-save", kind: "user_input", accessLabel: "private" },
    ]);
    expect(await db.select().from(schema.diagnosisAnswers)).toHaveLength(1);
  });

  it("同じChoiceの再送では行とacceptedAtを増やさずunchangedを返す", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-retry" });
    await insertDiagnosis(db, { id: "retry-target" });
    const firstAt = new Date("2026-08-03T00:00:00Z");
    const input = {
      accountId: "account-retry",
      diagnosisId: "retry-target",
      diagnosisQuestionId: "retry-target-sq1",
      choiceId: "yes",
    };
    await saveDiagnosisAnswer(db, { ...input, at: firstAt });

    const retried = await saveDiagnosisAnswer(db, {
      ...input,
      at: new Date("2026-08-03T01:00:00Z"),
    });

    expect(retried).toMatchObject({
      type: "saved",
      outcome: "unchanged",
      answer: { acceptedAt: firstAt.toISOString() },
    });
    expect(await db.select().from(schema.diagnosisResponses)).toHaveLength(1);
    expect(await db.select().from(schema.sourceRecords)).toHaveLength(1);
    expect(await db.select().from(schema.diagnosisAnswers)).toHaveLength(1);
  });

  it("異なるChoiceの再送を修正せずconflictにする", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-conflict" });
    await insertDiagnosis(db, { id: "conflict-target" });
    const base = {
      accountId: "account-conflict",
      diagnosisId: "conflict-target",
      diagnosisQuestionId: "conflict-target-sq1",
      at: new Date("2026-08-03T00:00:00Z"),
    };
    await saveDiagnosisAnswer(db, { ...base, choiceId: "yes" });

    await expect(saveDiagnosisAnswer(db, { ...base, choiceId: "no" })).resolves.toEqual({
      type: "answer-conflict",
    });
    expect(await db.select().from(schema.sourceRecords)).toHaveLength(1);
    expect((await db.select().from(schema.diagnosisAnswers))[0]?.choiceId).toBe("yes");
  });

  it("全問保存後にansweredを返す", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-complete" });
    await insertDiagnosis(db, { id: "complete-target" });
    const base = {
      accountId: "account-complete",
      diagnosisId: "complete-target",
      choiceId: "yes",
      at: new Date("2026-08-03T00:00:00Z"),
    };
    await saveDiagnosisAnswer(db, {
      ...base,
      diagnosisQuestionId: "complete-target-sq1",
    });
    const result = await saveDiagnosisAnswer(db, {
      ...base,
      diagnosisQuestionId: "complete-target-sq2",
    });
    expect(result).toMatchObject({
      type: "saved",
      progress: { responseStatus: "answered", answeredCount: 2, questionCount: 2 },
    });
  });

  it("異なる質問の同時回答でrevisionが先に進んでも最新revisionから保存を再試行する", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-revision-race" });
    await insertDiagnosis(db, { id: "revision-race-target" });
    await insertQuestion(db, "revision-race-target-q3");
    await db.insert(schema.diagnosisQuestions).values({
      id: "revision-race-target-sq3",
      diagnosisId: "revision-race-target",
      questionId: "revision-race-target-q3",
      questionVersion: 1,
      position: 2,
    });
    const base = {
      accountId: "account-revision-race",
      diagnosisId: "revision-race-target",
      choiceId: "yes",
      at: new Date("2026-08-03T00:00:00Z"),
    };
    await saveDiagnosisAnswer(db, {
      ...base,
      diagnosisQuestionId: "revision-race-target-sq1",
    });

    const originalBatch = db.batch.bind(db);
    let injectConcurrentAnswer = true;
    Object.assign(db, {
      batch: async (queries: Array<PromiseLike<unknown>>) => {
        if (injectConcurrentAnswer) {
          injectConcurrentAnswer = false;
          await saveDiagnosisAnswer(db, {
            ...base,
            diagnosisQuestionId: "revision-race-target-sq2",
          });
          // D1のatomic batchでは、競合した側の書き込みはこの一意制約違反とともにrollbackされる。
          throw new Error(
            "UNIQUE constraint failed: diagnosis_brain_projection_requests.diagnosis_response_id, diagnosis_brain_projection_requests.response_revision",
          );
        }
        return originalBatch(queries as never);
      },
    });

    await expect(
      saveDiagnosisAnswer(db, {
        ...base,
        diagnosisQuestionId: "revision-race-target-sq3",
      }),
    ).resolves.toMatchObject({
      type: "saved",
      outcome: "created",
      progress: { responseStatus: "answered", answeredCount: 3, questionCount: 3 },
    });

    expect(await db.select().from(schema.diagnosisAnswers)).toHaveLength(3);
    expect(await db.select().from(schema.sourceRecords)).toHaveLength(3);
    expect(await db.select().from(schema.diagnosisResponses)).toMatchObject([{ revision: 3 }]);
    expect(
      (await db.select().from(schema.diagnosisBrainProjectionRequests))
        .map(({ responseRevision }) => responseRevision)
        .sort((left, right) => left - right),
    ).toEqual([1, 2, 3]);
  });

  it.each([
    {
      name: "存在しないDiagnosis",
      input: { diagnosisId: "missing", diagnosisQuestionId: "sq", choiceId: "yes" },
      expected: "diagnosis-not-found",
    },
    {
      name: "Diagnosis外の質問",
      input: { diagnosisId: "validation-target", diagnosisQuestionId: "missing", choiceId: "yes" },
      expected: "diagnosis-question-not-found",
    },
    {
      name: "Question Version外のChoice",
      input: {
        diagnosisId: "validation-target",
        diagnosisQuestionId: "validation-target-sq1",
        choiceId: "maybe",
      },
      expected: "choice-not-found",
    },
  ])("$nameを$expectedにする", async ({ input, expected }) => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-validation" });
    await insertDiagnosis(db, { id: "validation-target" });
    const result = await saveDiagnosisAnswer(db, {
      accountId: "account-validation",
      at: new Date("2026-08-03T00:00:00Z"),
      ...input,
    });
    expect(result.type).toBe(expected);
    expect(await db.select().from(schema.sourceRecords)).toHaveLength(0);
  });

  it("受付終了後は何も保存しない", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-closed" });
    await insertDiagnosis(db, {
      id: "closed-save",
      closesAt: new Date("2026-08-02T00:00:00Z"),
    });
    const result = await saveDiagnosisAnswer(db, {
      accountId: "account-closed",
      diagnosisId: "closed-save",
      diagnosisQuestionId: "closed-save-sq1",
      choiceId: "yes",
      at: new Date("2026-08-03T00:00:00Z"),
    });
    expect(result).toEqual({ type: "diagnosis-closed" });
    expect(await db.select().from(schema.diagnosisResponses)).toHaveLength(0);
    expect(await db.select().from(schema.sourceRecords)).toHaveLength(0);
  });
});
