import { and, asc, count, desc, eq, inArray, lte } from "drizzle-orm";
import type { D1Client } from "../client";
import {
  diagnoses,
  diagnosisAnswers,
  diagnosisDeferredQuestions,
  diagnosisQuestions,
  diagnosisResponses,
  questionChoices,
  questions as questionRoots,
  questionVersions,
} from "../schema/diagnosis";
import { sourceRecords } from "../schema/source";

export type DiagnosisListAvailability = "open" | "closed";
export type DiagnosisListResponseStatus = "unanswered" | "in-progress" | "answered";

export type DiagnosisListItem = Readonly<{
  id: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string | null;
  availability: DiagnosisListAvailability;
  responseStatus: DiagnosisListResponseStatus;
  answeredCount: number;
  questionCount: number;
}>;

export type DiagnosisDetail = Readonly<{
  id: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string | null;
  questions: Array<{
    diagnosisQuestionId: string;
    questionId: string;
    questionVersion: number;
    text: string;
    hint: string | null;
    choices: Array<{
      choiceId: string;
      label: string;
      presentation: Record<string, string>;
    }>;
  }>;
}>;

export type DiagnosisDetailResult =
  | { type: "found"; diagnosis: DiagnosisDetail }
  | { type: "not-found" }
  | { type: "closed" };

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

export type DiagnosisAnswers = Readonly<{
  id: string;
  title: string;
  description: string;
  responseStatus: DiagnosisListResponseStatus;
  answeredCount: number;
  questionCount: number;
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
}>;

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
    message.includes("D1_ERROR") ||
    message.includes("SQLITE_CONSTRAINT")
  );
}

/**
 * 開発環境で回答フローをやり直すため、本人の診断回答由来データを物理削除します。
 * 呼び出し可能な環境の制限はAPI境界が担当します。
 */
export async function deleteAccountDiagnosisData(
  db: D1Client,
  accountId: string,
): Promise<DeletedAccountDiagnosisData> {
  const ownedResponseIds = db
    .select({ id: diagnosisResponses.id })
    .from(diagnosisResponses)
    .where(eq(diagnosisResponses.accountId, accountId));
  const answerSourceRecordIds = db
    .select({ id: diagnosisAnswers.sourceRecordId })
    .from(diagnosisAnswers)
    .where(inArray(diagnosisAnswers.diagnosisResponseId, ownedResponseIds));

  // D1のbatchは単一のatomic transactionとして直列実行される。
  // Source Record削除時のcascadeでAnswerと改訂関係も同じ境界内から除去する。
  const [answerCountRows, deletedSourceRecords, deletedDeferredQuestions, deletedResponses] =
    await db.batch([
      db
        .select({ value: count(diagnosisAnswers.id) })
        .from(diagnosisAnswers)
        .where(inArray(diagnosisAnswers.diagnosisResponseId, ownedResponseIds)),
      db.delete(sourceRecords).where(inArray(sourceRecords.id, answerSourceRecordIds)).returning({
        id: sourceRecords.id,
      }),
      db
        .delete(diagnosisDeferredQuestions)
        .where(inArray(diagnosisDeferredQuestions.diagnosisResponseId, ownedResponseIds))
        .returning({ id: diagnosisDeferredQuestions.id }),
      db
        .delete(diagnosisResponses)
        .where(eq(diagnosisResponses.accountId, accountId))
        .returning({ id: diagnosisResponses.id }),
    ]);

  return {
    deletedResponseCount: deletedResponses.length,
    deletedAnswerCount: answerCountRows[0]?.value ?? 0,
    deletedDeferredQuestionCount: deletedDeferredQuestions.length,
    deletedSourceRecordCount: deletedSourceRecords.length,
  };
}

async function findDiagnosisResponseId(
  db: D1Client,
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

async function findPersistedAnswer(
  db: D1Client,
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

async function buildSaveResult(
  db: D1Client,
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
  const responseStatus: DiagnosisListResponseStatus =
    answeredCount === 0
      ? "unanswered"
      : answeredCount === questionCount
        ? "answered"
        : "in-progress";

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
  db: D1Client,
  input: {
    accountId: string;
    diagnosisId: string;
    diagnosisQuestionId: string;
    choiceId: string;
    at: Date;
  },
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
        .values({ id: responseId, accountId: input.accountId, diagnosisId: input.diagnosisId })
        .onConflictDoNothing(),
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
    ]);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const concurrentResponseId = await findDiagnosisResponseId(
      db,
      input.accountId,
      input.diagnosisId,
    );
    const concurrent = concurrentResponseId
      ? await findPersistedAnswer(db, concurrentResponseId, input.diagnosisQuestionId)
      : undefined;
    if (!concurrent || !concurrentResponseId) {
      throw error;
    }
    return concurrent.choiceId === input.choiceId
      ? buildSaveResult(db, input.diagnosisId, concurrentResponseId, concurrent, "unchanged")
      : { type: "answer-conflict" };
  }

  return buildSaveResult(db, input.diagnosisId, responseId, answer, "created");
}

/**
 * 新規回答用のDiagnosis詳細を、Diagnosisが固定したQuestion Versionのまま取得します。
 * 非公開状態は存在有無を秘匿してnot-foundへ寄せ、受付終了だけを区別します。
 */
export async function findOpenDiagnosisDetail(
  db: D1Client,
  diagnosisId: string,
  at: Date,
): Promise<DiagnosisDetailResult> {
  const [diagnosis] = await db
    .select({
      id: diagnoses.id,
      title: diagnoses.title,
      description: diagnoses.description,
      opensAt: diagnoses.opensAt,
      closesAt: diagnoses.closesAt,
      state: diagnoses.state,
      isDeleted: diagnoses.isDeleted,
    })
    .from(diagnoses)
    .where(eq(diagnoses.id, diagnosisId))
    .limit(1);

  if (
    !diagnosis ||
    diagnosis.isDeleted ||
    diagnosis.state !== "published" ||
    diagnosis.opensAt.getTime() > at.getTime()
  ) {
    return { type: "not-found" };
  }
  if (diagnosis.closesAt && diagnosis.closesAt.getTime() <= at.getTime()) {
    return { type: "closed" };
  }

  const rows = await db
    .select({
      diagnosisQuestionId: diagnosisQuestions.id,
      questionId: diagnosisQuestions.questionId,
      questionVersion: diagnosisQuestions.questionVersion,
      text: questionVersions.text,
      hint: questionVersions.hint,
      choiceId: questionChoices.choiceId,
      choiceLabel: questionChoices.label,
      choicePresentation: questionChoices.presentation,
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
    .innerJoin(
      questionChoices,
      and(
        eq(questionChoices.questionId, diagnosisQuestions.questionId),
        eq(questionChoices.questionVersion, diagnosisQuestions.questionVersion),
        eq(questionChoices.isDeleted, false),
      ),
    )
    .where(
      and(eq(diagnosisQuestions.diagnosisId, diagnosisId), eq(diagnosisQuestions.isDeleted, false)),
    )
    .orderBy(asc(diagnosisQuestions.position), asc(questionChoices.position));

  const questions: DiagnosisDetail["questions"] = [];
  for (const row of rows) {
    const previous = questions.at(-1);
    const choice = {
      choiceId: row.choiceId,
      label: row.choiceLabel,
      presentation: row.choicePresentation ?? {},
    };
    if (previous?.diagnosisQuestionId === row.diagnosisQuestionId) {
      previous.choices.push(choice);
    } else {
      questions.push({
        diagnosisQuestionId: row.diagnosisQuestionId,
        questionId: row.questionId,
        questionVersion: row.questionVersion,
        text: row.text,
        hint: row.hint,
        choices: [choice],
      });
    }
  }

  return {
    type: "found",
    diagnosis: {
      id: diagnosis.id,
      title: diagnosis.title,
      description: diagnosis.description,
      opensAt: diagnosis.opensAt.toISOString(),
      closesAt: diagnosis.closesAt?.toISOString() ?? null,
      questions,
    },
  };
}

/** 本人の現在有効な回答を、回答時点のQuestion VersionとChoiceで取得します。 */
export async function findDiagnosisAnswers(
  db: D1Client,
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
    })
    .from(diagnosisResponses)
    .innerJoin(diagnoses, eq(diagnoses.id, diagnosisResponses.diagnosisId))
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
    response.state !== "published" ||
    response.opensAt.getTime() > at.getTime()
  ) {
    return { type: "not-found" };
  }

  const [questionCountRow, rows] = await Promise.all([
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
      .orderBy(asc(diagnosisQuestions.position)),
  ]);

  if (rows.length === 0) {
    return { type: "not-found" };
  }

  const questionCount = questionCountRow?.value ?? 0;
  const answeredCount = rows.length;
  return {
    type: "found",
    diagnosis: {
      id: response.id,
      title: response.title,
      description: response.description,
      responseStatus: answeredCount === questionCount ? "answered" : "in-progress",
      answeredCount,
      questionCount,
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
 * 公開前・公開停止・削除済みは含めません。受付終了後は回答内容への導線を残すため
 * `closed`として含めます。回答状態は現在有効なAnswerの件数から導出します。
 */
export async function listVisibleDiagnoses(
  db: D1Client,
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
      questionCount: count(diagnosisQuestions.id),
      answeredCount: count(diagnosisAnswers.id),
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
        eq(diagnoses.state, "published"),
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
      diagnoses.publishedAt,
    )
    .orderBy(desc(diagnoses.publishedAt), asc(diagnoses.id));

  return rows.map((row) => {
    const responseStatus: DiagnosisListResponseStatus =
      row.answeredCount === 0
        ? "unanswered"
        : row.answeredCount === row.questionCount
          ? "answered"
          : "in-progress";

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      opensAt: row.opensAt.toISOString(),
      closesAt: row.closesAt?.toISOString() ?? null,
      availability: row.closesAt && row.closesAt.getTime() <= at.getTime() ? "closed" : "open",
      responseStatus,
      answeredCount: row.answeredCount,
      questionCount: row.questionCount,
    };
  });
}
