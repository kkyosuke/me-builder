import { and, asc, count, eq, inArray, isNotNull, lte, max, or } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import {
  brainItemAccessLabels,
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItemTopicLabels,
  brainItems,
  brainVectorSyncJobs,
} from "../schema/brain";
import {
  diagnoses,
  diagnosisQuestions,
  diagnosisScoringConfigs,
  questionChoices,
  questions as questionRoots,
  questionVersions,
} from "../schema/catalog-snapshot";
import {
  diagnosisAnswers,
  diagnosisBrainProjectionHeads,
  diagnosisBrainProjectionRequests,
  diagnosisDeferredQuestions,
  diagnosisResponses,
} from "../schema/diagnosis";
import { sourceRecords } from "../schema/source";

type DiagnosisListAvailability = "open" | "closed";
type DiagnosisListResponseStatus = "unanswered" | "in-progress" | "answered";

function diagnosisResponseStatus(
  answeredCount: number,
  questionCount: number,
): DiagnosisListResponseStatus {
  if (answeredCount === 0) return "unanswered";
  return answeredCount === questionCount ? "answered" : "in-progress";
}

export type DiagnosisListItem = Readonly<{
  id: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string | null;
  displayOrder: number;
  availability: DiagnosisListAvailability;
  responseStatus: DiagnosisListResponseStatus;
  answeredCount: number;
  questionCount: number;
  lastAnsweredAt: string | null;
}>;

export type SaveDiagnosisAnswerResult =
  | {
      type: "saved";
      outcome: "created" | "unchanged";
      answer: {
        diagnosisQuestionId: string;
        questionId: string;
        questionVersion: number;
        choiceId: string;
        acceptedAt: string;
      };
      progress: {
        responseStatus: DiagnosisListResponseStatus;
        answeredCount: number;
        questionCount: number;
      };
    }
  | { type: "diagnosis-not-found" }
  | { type: "diagnosis-closed" }
  | { type: "diagnosis-question-not-found" }
  | { type: "choice-not-found" }
  | { type: "answer-conflict" };

export type DeferDiagnosisQuestionResult =
  | {
      type: "deferred";
      outcome: "created" | "unchanged";
      deferredQuestion: {
        diagnosisQuestionId: string;
        deferredAt: string;
      };
    }
  | { type: "diagnosis-not-found" }
  | { type: "diagnosis-closed" }
  | { type: "diagnosis-question-not-found" }
  | { type: "question-already-answered" };

type DiagnosisAnswers = Readonly<{
  id: string;
  title: string;
  description: string;
  responseStatus: DiagnosisListResponseStatus;
  answeredCount: number;
  questionCount: number;
  scoringConfig: {
    id: string;
    version: number;
    definition: unknown;
    questions: Array<{
      questionId: string;
      questionVersion: number;
      choiceIds: string[];
    }>;
  } | null;
  answers: Array<{
    diagnosisQuestionId: string;
    questionId: string;
    questionVersion: number;
    questionText: string;
    choiceId: string;
    choiceLabel: string;
    acceptedAt: string;
  }>;
}>;

export type DiagnosisAnswersResult =
  | { type: "found"; diagnosis: DiagnosisAnswers }
  | { type: "not-found" };

export type DeletedAccountDiagnosisData = Readonly<{
  deletedResponseCount: number;
  deletedAnswerCount: number;
  deletedDeferredQuestionCount: number;
  deletedSourceRecordCount: number;
  deletedBrainItemCount: number;
}>;

type SaveDiagnosisAnswerInput = {
  accountId: string;
  diagnosisId: string;
  diagnosisQuestionId: string;
  choiceId: string;
  at: Date;
};

type PersistedAnswer = {
  diagnosisQuestionId: string;
  questionId: string;
  questionVersion: number;
  choiceId: string;
  acceptedAt: Date;
};

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("UNIQUE constraint failed") ||
    message.includes("SQLITE_CONSTRAINT_UNIQUE") ||
    message.includes("SQLITE_CONSTRAINT_PRIMARYKEY")
  );
}

const RESET_DELETE_CHUNK_SIZE = 49;
const RESET_MAX_ATTEMPTS = 3;
const DIAGNOSIS_WRITE_MAX_ATTEMPTS = 3;

type D1BatchStatement = Parameters<AccountDataDatabase["batch"]>[0][number];

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/** Projection Headから現在Itemとその改訂元をたどり、診断projectionが所有するItemだけを返す。 */
async function findDiagnosisProjectionBrainItemIds(
  db: AccountDataDatabase,
  accountId: string,
): Promise<string[]> {
  const heads = await db
    .select({ brainItemId: diagnosisBrainProjectionHeads.currentBrainItemId })
    .from(diagnosisBrainProjectionHeads)
    .where(eq(diagnosisBrainProjectionHeads.accountId, accountId));
  const brainItemIds = new Set(heads.map(({ brainItemId }) => brainItemId));
  let frontier = [...brainItemIds];

  while (frontier.length > 0) {
    const revisions: Array<{ brainItemId: string }> = [];
    for (const brainItemIdChunk of chunks(frontier, RESET_DELETE_CHUNK_SIZE)) {
      revisions.push(
        ...(await db
          .select({ brainItemId: brainItemRevisions.previousBrainItemId })
          .from(brainItemRevisions)
          .where(and(inArray(brainItemRevisions.nextBrainItemId, brainItemIdChunk)))),
      );
    }
    frontier = revisions
      .map(({ brainItemId }) => brainItemId)
      .filter((brainItemId) => !brainItemIds.has(brainItemId));
    for (const brainItemId of frontier) brainItemIds.add(brainItemId);
  }

  return [...brainItemIds];
}

function isForeignKeyViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("FOREIGN KEY constraint failed");
}

async function deleteAccountDiagnosisDataOnce(
  db: AccountDataDatabase,
  accountId: string,
): Promise<DeletedAccountDiagnosisData> {
  const deletedAt = new Date();
  const projectionBrainItemIds = await findDiagnosisProjectionBrainItemIds(db, accountId);
  const projectionBrainItemIdChunks = chunks(projectionBrainItemIds, RESET_DELETE_CHUNK_SIZE);
  const ownedResponseIds = db
    .select({ id: diagnosisResponses.id })
    .from(diagnosisResponses)
    .where(eq(diagnosisResponses.accountId, accountId));
  const answerSourceRecordIds = db
    .select({ id: diagnosisAnswers.sourceRecordId })
    .from(diagnosisAnswers)
    .where(inArray(diagnosisAnswers.diagnosisResponseId, ownedResponseIds));

  const statements: D1BatchStatement[] = [
    db
      .select({ value: count(diagnosisAnswers.id) })
      .from(diagnosisAnswers)
      .where(inArray(diagnosisAnswers.diagnosisResponseId, ownedResponseIds)),
    db
      .delete(diagnosisBrainProjectionHeads)
      .where(eq(diagnosisBrainProjectionHeads.accountId, accountId)),
  ];

  // Revisionは同じID一覧を2回bindするため、SQLiteのparameter上限内で分割する。
  for (const brainItemIdChunk of projectionBrainItemIdChunks) {
    statements.push(
      db
        .delete(brainItemAccessLabels)
        .where(and(inArray(brainItemAccessLabels.brainItemId, brainItemIdChunk))),
      db
        .delete(brainItemTopicLabels)
        .where(and(inArray(brainItemTopicLabels.brainItemId, brainItemIdChunk))),
      db
        .delete(brainItemEvidenceEdges)
        .where(and(inArray(brainItemEvidenceEdges.brainItemId, brainItemIdChunk))),
      db
        .delete(brainItemRevisions)
        .where(
          and(
            or(
              inArray(brainItemRevisions.previousBrainItemId, brainItemIdChunk),
              inArray(brainItemRevisions.nextBrainItemId, brainItemIdChunk),
            ),
          ),
        ),
    );
  }
  for (const brainItemIdChunk of projectionBrainItemIdChunks) {
    for (const brainItemId of brainItemIdChunk) {
      statements.push(
        db.insert(brainVectorSyncJobs).values({
          id: `${brainItemId}:${deletedAt.getTime()}:delete`,
          brainItemId,
          itemRevision: deletedAt.getTime(),
          operation: "delete",
          status: "pending",
          nextAttemptAt: deletedAt,
          createdAt: deletedAt,
          updatedAt: deletedAt,
        }),
      );
    }
    statements.push(
      db
        .delete(brainItems)
        .where(and(eq(brainItems.accountId, accountId), inArray(brainItems.id, brainItemIdChunk))),
    );
  }

  const sourceRecordResultIndex = statements.length;
  statements.push(
    db.delete(sourceRecords).where(inArray(sourceRecords.id, answerSourceRecordIds)).returning({
      id: sourceRecords.id,
    }),
  );
  const deferredQuestionResultIndex = statements.length;
  statements.push(
    db
      .delete(diagnosisDeferredQuestions)
      .where(inArray(diagnosisDeferredQuestions.diagnosisResponseId, ownedResponseIds))
      .returning({ id: diagnosisDeferredQuestions.id }),
  );
  const responseResultIndex = statements.length;
  statements.push(
    db
      .delete(diagnosisResponses)
      .where(eq(diagnosisResponses.accountId, accountId))
      .returning({ id: diagnosisResponses.id }),
  );

  const [firstStatement, ...remainingStatements] = statements;
  if (!firstStatement) throw new Error("診断データ削除statementがありません");
  const results = await db.batch([firstStatement, ...remainingStatements]);
  const answerCountRows = results[0] as Array<{ value: number }>;
  const deletedSourceRecords = results[sourceRecordResultIndex] as Array<{ id: string }>;
  const deletedDeferredQuestions = results[deferredQuestionResultIndex] as Array<{ id: string }>;
  const deletedResponses = results[responseResultIndex] as Array<{ id: string }>;

  return {
    deletedResponseCount: deletedResponses.length,
    deletedAnswerCount: answerCountRows[0]?.value ?? 0,
    deletedDeferredQuestionCount: deletedDeferredQuestions.length,
    deletedSourceRecordCount: deletedSourceRecords.length,
    deletedBrainItemCount: projectionBrainItemIds.length,
  };
}

/**
 * 開発環境で回答フローをやり直すため、本人の診断回答由来データを物理削除します。
 * 呼び出し可能な環境の制限はAPI境界が担当します。
 */
export async function deleteAccountDiagnosisData(
  db: AccountDataDatabase,
  accountId: string,
): Promise<DeletedAccountDiagnosisData> {
  for (let attempt = 1; attempt <= RESET_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await deleteAccountDiagnosisDataOnce(db, accountId);
    } catch (error) {
      if (!isForeignKeyViolation(error) || attempt === RESET_MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("診断データ削除の再試行回数を超過しました");
}

async function findDiagnosisResponseId(
  db: AccountDataDatabase,
  accountId: string,
  diagnosisId: string,
): Promise<string | undefined> {
  const response = await db
    .select({ id: diagnosisResponses.id })
    .from(diagnosisResponses)
    .where(
      and(
        eq(diagnosisResponses.accountId, accountId),
        eq(diagnosisResponses.diagnosisId, diagnosisId),
        eq(diagnosisResponses.isDeleted, false),
      ),
    )
    .get();
  return response?.id;
}

/** 本人に削除されていないDiagnosisResponseがあるかを返します。 */
export async function hasDiagnosisResponse(
  db: AccountDataDatabase,
  accountId: string,
  diagnosisId: string,
): Promise<boolean> {
  return (await findDiagnosisResponseId(db, accountId, diagnosisId)) !== undefined;
}

async function findPersistedAnswer(
  db: AccountDataDatabase,
  responseId: string,
  diagnosisQuestionId: string,
): Promise<PersistedAnswer | undefined> {
  return await db
    .select({
      diagnosisQuestionId: diagnosisAnswers.diagnosisQuestionId,
      questionId: diagnosisAnswers.questionId,
      questionVersion: diagnosisAnswers.questionVersion,
      choiceId: diagnosisAnswers.choiceId,
      acceptedAt: diagnosisAnswers.acceptedAt,
    })
    .from(diagnosisAnswers)
    .where(
      and(
        eq(diagnosisAnswers.diagnosisResponseId, responseId),
        eq(diagnosisAnswers.diagnosisQuestionId, diagnosisQuestionId),
        eq(diagnosisAnswers.isDeleted, false),
      ),
    )
    .get();
}

async function findDeferredQuestion(
  db: AccountDataDatabase,
  responseId: string,
  diagnosisQuestionId: string,
): Promise<{ diagnosisQuestionId: string; deferredAt: Date } | undefined> {
  return await db
    .select({
      diagnosisQuestionId: diagnosisDeferredQuestions.diagnosisQuestionId,
      deferredAt: diagnosisDeferredQuestions.deferredAt,
    })
    .from(diagnosisDeferredQuestions)
    .where(
      and(
        eq(diagnosisDeferredQuestions.diagnosisResponseId, responseId),
        eq(diagnosisDeferredQuestions.diagnosisQuestionId, diagnosisQuestionId),
        eq(diagnosisDeferredQuestions.isDeleted, false),
      ),
    )
    .get();
}

function deferredResult(
  deferredQuestion: { diagnosisQuestionId: string; deferredAt: Date },
  outcome: "created" | "unchanged",
): DeferDiagnosisQuestionResult {
  return {
    type: "deferred",
    outcome,
    deferredQuestion: {
      diagnosisQuestionId: deferredQuestion.diagnosisQuestionId,
      deferredAt: deferredQuestion.deferredAt.toISOString(),
    },
  };
}

/** 受付中Diagnosisの未回答の1問を、再送可能な「あとで回答」として保存します。 */
export async function deferDiagnosisQuestion(
  db: AccountDataDatabase,
  input: {
    accountId: string;
    diagnosisId: string;
    diagnosisQuestionId: string;
    at: Date;
  },
): Promise<DeferDiagnosisQuestionResult> {
  return deferDiagnosisQuestionWithResponseRetry(db, input, 1);
}

async function deferDiagnosisQuestionWithResponseRetry(
  db: AccountDataDatabase,
  input: {
    accountId: string;
    diagnosisId: string;
    diagnosisQuestionId: string;
    at: Date;
  },
  attempt: number,
): Promise<DeferDiagnosisQuestionResult> {
  const diagnosis = await db
    .select({
      state: diagnoses.state,
      opensAt: diagnoses.opensAt,
      closesAt: diagnoses.closesAt,
      isDeleted: diagnoses.isDeleted,
    })
    .from(diagnoses)
    .where(eq(diagnoses.id, input.diagnosisId))
    .get();
  if (
    !diagnosis ||
    diagnosis.isDeleted ||
    diagnosis.state !== "published" ||
    diagnosis.opensAt.getTime() > input.at.getTime()
  ) {
    return { type: "diagnosis-not-found" };
  }
  if (diagnosis.closesAt && diagnosis.closesAt.getTime() <= input.at.getTime()) {
    return { type: "diagnosis-closed" };
  }

  const diagnosisQuestion = await db
    .select({ id: diagnosisQuestions.id })
    .from(diagnosisQuestions)
    .where(
      and(
        eq(diagnosisQuestions.id, input.diagnosisQuestionId),
        eq(diagnosisQuestions.diagnosisId, input.diagnosisId),
        eq(diagnosisQuestions.isDeleted, false),
      ),
    )
    .get();
  if (!diagnosisQuestion) {
    return { type: "diagnosis-question-not-found" };
  }

  const observedResponseId = await findDiagnosisResponseId(db, input.accountId, input.diagnosisId);
  if (observedResponseId) {
    if (await findPersistedAnswer(db, observedResponseId, input.diagnosisQuestionId)) {
      return { type: "question-already-answered" };
    }
    const existing = await findDeferredQuestion(db, observedResponseId, input.diagnosisQuestionId);
    if (existing) {
      return deferredResult(existing, "unchanged");
    }
  }

  const responseId = observedResponseId ?? crypto.randomUUID();
  const deferredAt = new Date(Math.floor(input.at.getTime() / 1000) * 1000);
  const deferredQuestion = { diagnosisQuestionId: diagnosisQuestion.id, deferredAt };
  try {
    await db.batch([
      db
        .insert(diagnosisResponses)
        .values({ id: responseId, accountId: input.accountId, diagnosisId: input.diagnosisId })
        .onConflictDoNothing(),
      db.insert(diagnosisDeferredQuestions).values({
        id: crypto.randomUUID(),
        diagnosisResponseId: responseId,
        diagnosisQuestionId: diagnosisQuestion.id,
        deferredAt,
      }),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error) && !isForeignKeyViolation(error)) {
      throw error;
    }
    const concurrentResponseId = await findDiagnosisResponseId(
      db,
      input.accountId,
      input.diagnosisId,
    );
    if (concurrentResponseId) {
      if (await findPersistedAnswer(db, concurrentResponseId, input.diagnosisQuestionId)) {
        return { type: "question-already-answered" };
      }
      const concurrent = await findDeferredQuestion(
        db,
        concurrentResponseId,
        input.diagnosisQuestionId,
      );
      if (concurrent) {
        return deferredResult(concurrent, "unchanged");
      }
      if (concurrentResponseId !== responseId && attempt < DIAGNOSIS_WRITE_MAX_ATTEMPTS) {
        return deferDiagnosisQuestionWithResponseRetry(db, input, attempt + 1);
      }
    }
    throw error;
  }
  return deferredResult(deferredQuestion, "created");
}

async function buildSaveResult(
  db: AccountDataDatabase,
  diagnosisId: string,
  responseId: string,
  answer: PersistedAnswer,
  outcome: "created" | "unchanged",
): Promise<SaveDiagnosisAnswerResult> {
  const [questionCountRow, answeredCountRow] = await Promise.all([
    db
      .select({ value: count(diagnosisQuestions.id) })
      .from(diagnosisQuestions)
      .where(
        and(
          eq(diagnosisQuestions.diagnosisId, diagnosisId),
          eq(diagnosisQuestions.isDeleted, false),
        ),
      )
      .get(),
    db
      .select({ value: count(diagnosisAnswers.id) })
      .from(diagnosisAnswers)
      .innerJoin(
        diagnosisQuestions,
        and(
          eq(diagnosisQuestions.id, diagnosisAnswers.diagnosisQuestionId),
          eq(diagnosisQuestions.diagnosisId, diagnosisId),
          eq(diagnosisQuestions.isDeleted, false),
        ),
      )
      .where(
        and(
          eq(diagnosisAnswers.diagnosisResponseId, responseId),
          eq(diagnosisAnswers.isDeleted, false),
        ),
      )
      .get(),
  ]);
  const questionCount = questionCountRow?.value ?? 0;
  const answeredCount = answeredCountRow?.value ?? 0;
  const responseStatus = diagnosisResponseStatus(answeredCount, questionCount);

  return {
    type: "saved",
    outcome,
    answer: {
      ...answer,
      acceptedAt: answer.acceptedAt.toISOString(),
    },
    progress: { responseStatus, answeredCount, questionCount },
  };
}

/**
 * 受付中Diagnosisの1問へ初回回答を保存します。
 * DiagnosisResponse・Source Record・AnswerはD1 batchで原子的に作成します。
 */
export async function saveDiagnosisAnswer(
  db: AccountDataDatabase,
  input: SaveDiagnosisAnswerInput,
): Promise<SaveDiagnosisAnswerResult> {
  return saveDiagnosisAnswerWithRevisionRetry(db, input, 1);
}

async function saveDiagnosisAnswerWithRevisionRetry(
  db: AccountDataDatabase,
  input: SaveDiagnosisAnswerInput,
  attempt: number,
): Promise<SaveDiagnosisAnswerResult> {
  const diagnosis = await db
    .select({
      state: diagnoses.state,
      opensAt: diagnoses.opensAt,
      closesAt: diagnoses.closesAt,
      isDeleted: diagnoses.isDeleted,
    })
    .from(diagnoses)
    .where(eq(diagnoses.id, input.diagnosisId))
    .get();
  if (
    !diagnosis ||
    diagnosis.isDeleted ||
    diagnosis.state !== "published" ||
    diagnosis.opensAt.getTime() > input.at.getTime()
  ) {
    return { type: "diagnosis-not-found" };
  }
  if (diagnosis.closesAt && diagnosis.closesAt.getTime() <= input.at.getTime()) {
    return { type: "diagnosis-closed" };
  }

  const diagnosisQuestion = await db
    .select({
      id: diagnosisQuestions.id,
      questionId: diagnosisQuestions.questionId,
      questionVersion: diagnosisQuestions.questionVersion,
    })
    .from(diagnosisQuestions)
    .innerJoin(
      questionRoots,
      and(eq(questionRoots.id, diagnosisQuestions.questionId), eq(questionRoots.isDeleted, false)),
    )
    .innerJoin(
      questionVersions,
      and(
        eq(questionVersions.questionId, diagnosisQuestions.questionId),
        eq(questionVersions.version, diagnosisQuestions.questionVersion),
        eq(questionVersions.isDeleted, false),
      ),
    )
    .where(
      and(
        eq(diagnosisQuestions.id, input.diagnosisQuestionId),
        eq(diagnosisQuestions.diagnosisId, input.diagnosisId),
        eq(diagnosisQuestions.isDeleted, false),
      ),
    )
    .get();
  if (!diagnosisQuestion) {
    return { type: "diagnosis-question-not-found" };
  }

  const choice = await db
    .select({ id: questionChoices.choiceId })
    .from(questionChoices)
    .where(
      and(
        eq(questionChoices.questionId, diagnosisQuestion.questionId),
        eq(questionChoices.questionVersion, diagnosisQuestion.questionVersion),
        eq(questionChoices.choiceId, input.choiceId),
        eq(questionChoices.isDeleted, false),
      ),
    )
    .get();
  if (!choice) {
    return { type: "choice-not-found" };
  }

  const observedResponseId = await findDiagnosisResponseId(db, input.accountId, input.diagnosisId);
  if (observedResponseId) {
    const existing = await findPersistedAnswer(db, observedResponseId, input.diagnosisQuestionId);
    if (existing) {
      return existing.choiceId === input.choiceId
        ? buildSaveResult(db, input.diagnosisId, observedResponseId, existing, "unchanged")
        : { type: "answer-conflict" };
    }
  }

  const responseId = observedResponseId ?? crypto.randomUUID();
  const observedRevision = observedResponseId
    ? ((
        await db
          .select({ revision: diagnosisResponses.revision })
          .from(diagnosisResponses)
          .where(eq(diagnosisResponses.id, observedResponseId))
          .get()
      )?.revision ?? 0)
    : 0;
  const responseRevision = observedRevision + 1;
  const projectionRequestId = crypto.randomUUID();
  const sourceRecordId = crypto.randomUUID();
  const answerId = crypto.randomUUID();
  // D1のtimestamp modeは秒精度なので、初回レスポンスと再送レスポンスを同じ値に揃えます。
  const acceptedAt = new Date(Math.floor(input.at.getTime() / 1000) * 1000);
  const answer: PersistedAnswer = {
    diagnosisQuestionId: diagnosisQuestion.id,
    questionId: diagnosisQuestion.questionId,
    questionVersion: diagnosisQuestion.questionVersion,
    choiceId: input.choiceId,
    acceptedAt,
  };

  try {
    await db.batch([
      db
        .insert(diagnosisResponses)
        .values({
          id: responseId,
          accountId: input.accountId,
          diagnosisId: input.diagnosisId,
          revision: observedRevision,
        })
        .onConflictDoNothing(),
      db
        .update(diagnosisResponses)
        .set({ revision: responseRevision, updatedAt: acceptedAt })
        .where(
          and(
            eq(diagnosisResponses.id, responseId),
            eq(diagnosisResponses.revision, observedRevision),
          ),
        ),
      db.insert(sourceRecords).values({
        id: sourceRecordId,
        accountId: input.accountId,
        kind: "user_input",
        accessLabel: "private",
      }),
      db.insert(diagnosisAnswers).values({
        id: answerId,
        diagnosisResponseId: responseId,
        diagnosisQuestionId: answer.diagnosisQuestionId,
        questionId: answer.questionId,
        questionVersion: answer.questionVersion,
        choiceId: answer.choiceId,
        acceptedAt: answer.acceptedAt,
        sourceRecordId,
      }),
      db
        .update(diagnosisDeferredQuestions)
        .set({ isDeleted: true, deletedAt: acceptedAt, updatedAt: acceptedAt })
        .where(
          and(
            eq(diagnosisDeferredQuestions.diagnosisResponseId, responseId),
            eq(diagnosisDeferredQuestions.diagnosisQuestionId, input.diagnosisQuestionId),
            eq(diagnosisDeferredQuestions.isDeleted, false),
          ),
        ),
      db.insert(diagnosisBrainProjectionRequests).values({
        id: projectionRequestId,
        diagnosisResponseId: responseId,
        responseRevision,
        status: "pending",
        nextAttemptAt: acceptedAt,
      }),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error) && !isForeignKeyViolation(error)) {
      throw error;
    }
    const concurrentResponse = await db
      .select({ id: diagnosisResponses.id, revision: diagnosisResponses.revision })
      .from(diagnosisResponses)
      .where(
        and(
          eq(diagnosisResponses.accountId, input.accountId),
          eq(diagnosisResponses.diagnosisId, input.diagnosisId),
          eq(diagnosisResponses.isDeleted, false),
        ),
      )
      .get();
    const concurrent = concurrentResponse
      ? await findPersistedAnswer(db, concurrentResponse.id, input.diagnosisQuestionId)
      : undefined;
    if (concurrent && concurrentResponse) {
      return concurrent.choiceId === input.choiceId
        ? buildSaveResult(db, input.diagnosisId, concurrentResponse.id, concurrent, "unchanged")
        : { type: "answer-conflict" };
    }

    // 異なる質問の回答が先に同じrevisionを確保した場合だけ、最新revisionから保存をやり直す。
    // response作成競合ではIDが、既存responseのCAS競合ではrevisionが進むため判別できる。
    if (
      concurrentResponse &&
      attempt < DIAGNOSIS_WRITE_MAX_ATTEMPTS &&
      (concurrentResponse.id !== responseId || concurrentResponse.revision > observedRevision)
    ) {
      return saveDiagnosisAnswerWithRevisionRetry(db, input, attempt + 1);
    }
    throw error;
  }

  return buildSaveResult(db, input.diagnosisId, responseId, answer, "created");
}

/** 本人の現在有効な回答を、回答時点のQuestion VersionとChoiceで取得します。 */
export async function findDiagnosisAnswers(
  db: AccountDataDatabase,
  accountId: string,
  diagnosisId: string,
  at: Date,
): Promise<DiagnosisAnswersResult> {
  const response = await db
    .select({
      responseId: diagnosisResponses.id,
      id: diagnoses.id,
      title: diagnoses.title,
      description: diagnoses.description,
      opensAt: diagnoses.opensAt,
      state: diagnoses.state,
      diagnosisIsDeleted: diagnoses.isDeleted,
      scoringConfigId: diagnosisScoringConfigs.id,
      scoringConfigVersion: diagnosisScoringConfigs.version,
      scoringConfigDefinition: diagnosisScoringConfigs.definition,
    })
    .from(diagnosisResponses)
    .innerJoin(diagnoses, eq(diagnoses.id, diagnosisResponses.diagnosisId))
    .leftJoin(
      diagnosisScoringConfigs,
      and(
        eq(diagnosisScoringConfigs.id, diagnoses.scoringConfigId),
        eq(diagnosisScoringConfigs.isDeleted, false),
      ),
    )
    .where(
      and(
        eq(diagnosisResponses.accountId, accountId),
        eq(diagnosisResponses.diagnosisId, diagnosisId),
        eq(diagnosisResponses.isDeleted, false),
      ),
    )
    .get();

  if (
    !response ||
    response.diagnosisIsDeleted ||
    (response.state !== "published" && response.state !== "withdrawn") ||
    response.opensAt.getTime() > at.getTime()
  ) {
    return { type: "not-found" };
  }

  const [questionCountRow, scoringQuestionRows, rows] = await Promise.all([
    db
      .select({ value: count(diagnosisQuestions.id) })
      .from(diagnosisQuestions)
      .where(
        and(
          eq(diagnosisQuestions.diagnosisId, diagnosisId),
          eq(diagnosisQuestions.isDeleted, false),
        ),
      )
      .get(),
    db
      .select({
        questionId: diagnosisQuestions.questionId,
        questionVersion: diagnosisQuestions.questionVersion,
        choiceId: questionChoices.choiceId,
      })
      .from(diagnosisQuestions)
      .innerJoin(
        questionRoots,
        and(
          eq(questionRoots.id, diagnosisQuestions.questionId),
          eq(questionRoots.isDeleted, false),
        ),
      )
      .innerJoin(
        questionVersions,
        and(
          eq(questionVersions.questionId, diagnosisQuestions.questionId),
          eq(questionVersions.version, diagnosisQuestions.questionVersion),
          eq(questionVersions.isDeleted, false),
        ),
      )
      .innerJoin(
        questionChoices,
        and(
          eq(questionChoices.questionId, diagnosisQuestions.questionId),
          eq(questionChoices.questionVersion, diagnosisQuestions.questionVersion),
          eq(questionChoices.isDeleted, false),
        ),
      )
      .where(
        and(
          eq(diagnosisQuestions.diagnosisId, diagnosisId),
          eq(diagnosisQuestions.isDeleted, false),
        ),
      )
      .orderBy(asc(diagnosisQuestions.position), asc(questionChoices.position))
      .all(),
    db
      .select({
        diagnosisQuestionId: diagnosisAnswers.diagnosisQuestionId,
        questionId: diagnosisAnswers.questionId,
        questionVersion: diagnosisAnswers.questionVersion,
        questionText: questionVersions.text,
        choiceId: diagnosisAnswers.choiceId,
        choiceLabel: questionChoices.label,
        acceptedAt: diagnosisAnswers.acceptedAt,
      })
      .from(diagnosisAnswers)
      .innerJoin(
        diagnosisQuestions,
        and(
          eq(diagnosisQuestions.id, diagnosisAnswers.diagnosisQuestionId),
          eq(diagnosisQuestions.diagnosisId, diagnosisId),
        ),
      )
      .innerJoin(
        questionVersions,
        and(
          eq(questionVersions.questionId, diagnosisAnswers.questionId),
          eq(questionVersions.version, diagnosisAnswers.questionVersion),
        ),
      )
      .innerJoin(
        questionChoices,
        and(
          eq(questionChoices.questionId, diagnosisAnswers.questionId),
          eq(questionChoices.questionVersion, diagnosisAnswers.questionVersion),
          eq(questionChoices.choiceId, diagnosisAnswers.choiceId),
        ),
      )
      .where(
        and(
          eq(diagnosisAnswers.diagnosisResponseId, response.responseId),
          eq(diagnosisAnswers.isDeleted, false),
          eq(diagnosisQuestions.isDeleted, false),
        ),
      )
      .orderBy(asc(diagnosisQuestions.position))
      .all(),
  ]);

  if (rows.length === 0) {
    return { type: "not-found" };
  }

  const questionCount = questionCountRow?.value ?? 0;
  const answeredCount = rows.length;
  const scoringQuestions: NonNullable<DiagnosisAnswers["scoringConfig"]>["questions"] = [];
  for (const row of scoringQuestionRows) {
    const previous = scoringQuestions.at(-1);
    if (previous?.questionId === row.questionId) {
      previous.choiceIds.push(row.choiceId);
    } else {
      scoringQuestions.push({
        questionId: row.questionId,
        questionVersion: row.questionVersion,
        choiceIds: [row.choiceId],
      });
    }
  }
  return {
    type: "found",
    diagnosis: {
      id: response.id,
      title: response.title,
      description: response.description,
      responseStatus: diagnosisResponseStatus(answeredCount, questionCount),
      answeredCount,
      questionCount,
      scoringConfig:
        response.scoringConfigId &&
        response.scoringConfigVersion !== null &&
        response.scoringConfigDefinition !== null
          ? {
              id: response.scoringConfigId,
              version: response.scoringConfigVersion,
              definition: response.scoringConfigDefinition,
              questions: scoringQuestions,
            }
          : null,
      answers: rows.map((answer) => ({
        ...answer,
        acceptedAt: answer.acceptedAt.toISOString(),
      })),
    },
  };
}

/**
 * 一覧へ表示できるDiagnosisと、指定Accountの現在の回答進捗を取得します。
 *
 * 公開前・削除済みは含めません。公開停止は本人にDiagnosisResponseがある場合だけ、
 * 受付終了と同じく回答内容への導線を残すため`closed`として含めます。
 * 回答状態は現在有効なAnswerの件数から導出します。
 */
export async function listVisibleDiagnoses(
  db: AccountDataDatabase,
  accountId: string,
  at: Date,
): Promise<DiagnosisListItem[]> {
  const rows = await db
    .select({
      id: diagnoses.id,
      title: diagnoses.title,
      description: diagnoses.description,
      opensAt: diagnoses.opensAt,
      closesAt: diagnoses.closesAt,
      state: diagnoses.state,
      displayOrder: diagnoses.displayOrder,
      questionCount: count(diagnosisQuestions.id),
      answeredCount: count(diagnosisAnswers.id),
      lastAnsweredAt: max(diagnosisAnswers.acceptedAt),
    })
    .from(diagnoses)
    .innerJoin(
      diagnosisQuestions,
      and(
        eq(diagnosisQuestions.diagnosisId, diagnoses.id),
        eq(diagnosisQuestions.isDeleted, false),
      ),
    )
    .leftJoin(
      diagnosisResponses,
      and(
        eq(diagnosisResponses.diagnosisId, diagnoses.id),
        eq(diagnosisResponses.accountId, accountId),
        eq(diagnosisResponses.isDeleted, false),
      ),
    )
    .leftJoin(
      diagnosisAnswers,
      and(
        eq(diagnosisAnswers.diagnosisResponseId, diagnosisResponses.id),
        eq(diagnosisAnswers.diagnosisQuestionId, diagnosisQuestions.id),
        eq(diagnosisAnswers.isDeleted, false),
      ),
    )
    .where(
      and(
        or(
          eq(diagnoses.state, "published"),
          and(eq(diagnoses.state, "withdrawn"), isNotNull(diagnosisResponses.id)),
        ),
        eq(diagnoses.isDeleted, false),
        lte(diagnoses.opensAt, at),
      ),
    )
    .groupBy(
      diagnoses.id,
      diagnoses.title,
      diagnoses.description,
      diagnoses.opensAt,
      diagnoses.closesAt,
      diagnoses.state,
      diagnoses.displayOrder,
    )
    .orderBy(asc(diagnoses.displayOrder), asc(diagnoses.id))
    .all();

  return rows.map((row) => {
    const responseStatus = diagnosisResponseStatus(row.answeredCount, row.questionCount);

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      opensAt: row.opensAt.toISOString(),
      closesAt: row.closesAt?.toISOString() ?? null,
      displayOrder: row.displayOrder,
      availability:
        row.state === "withdrawn" || (row.closesAt && row.closesAt.getTime() <= at.getTime())
          ? "closed"
          : "open",
      responseStatus,
      answeredCount: row.answeredCount,
      questionCount: row.questionCount,
      lastAnsweredAt: row.lastAnsweredAt?.toISOString() ?? null,
    };
  });
}
