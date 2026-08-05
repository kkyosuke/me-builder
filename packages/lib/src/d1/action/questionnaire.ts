import { and, asc, count, desc, eq, lte } from "drizzle-orm";
import type { D1Client } from "../client";
import {
  questionChoices,
  questions as questionRoots,
  questionVersions,
  surveyAnswers,
  surveyDeferredQuestions,
  surveyQuestions,
  surveyResponses,
  surveys,
} from "../schema/questionnaire";
import { sourceRecords } from "../schema/source";

export type SurveyListAvailability = "open" | "closed";
export type SurveyListResponseStatus = "unanswered" | "in-progress" | "answered";

export type SurveyListItem = Readonly<{
  id: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string | null;
  availability: SurveyListAvailability;
  responseStatus: SurveyListResponseStatus;
  answeredCount: number;
  questionCount: number;
}>;

export type SurveyDetail = Readonly<{
  id: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string | null;
  questions: Array<{
    surveyQuestionId: string;
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

export type SurveyDetailResult =
  | { type: "found"; survey: SurveyDetail }
  | { type: "not-found" }
  | { type: "closed" };

export type SaveSurveyAnswerResult =
  | {
      type: "saved";
      outcome: "created" | "unchanged";
      answer: {
        surveyQuestionId: string;
        questionId: string;
        questionVersion: number;
        choiceId: string;
        acceptedAt: string;
      };
      progress: {
        responseStatus: SurveyListResponseStatus;
        answeredCount: number;
        questionCount: number;
      };
    }
  | { type: "survey-not-found" }
  | { type: "survey-closed" }
  | { type: "survey-question-not-found" }
  | { type: "choice-not-found" }
  | { type: "answer-conflict" };

export type SurveyAnswers = Readonly<{
  id: string;
  title: string;
  description: string;
  responseStatus: SurveyListResponseStatus;
  answeredCount: number;
  questionCount: number;
  answers: Array<{
    surveyQuestionId: string;
    questionId: string;
    questionVersion: number;
    questionText: string;
    choiceId: string;
    choiceLabel: string;
    acceptedAt: string;
  }>;
}>;

export type SurveyAnswersResult = { type: "found"; survey: SurveyAnswers } | { type: "not-found" };

type PersistedAnswer = {
  surveyQuestionId: string;
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

async function findSurveyResponseId(
  db: D1Client,
  accountId: string,
  surveyId: string,
): Promise<string | undefined> {
  const response = await db
    .select({ id: surveyResponses.id })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.accountId, accountId),
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.isDeleted, false),
      ),
    )
    .get();
  return response?.id;
}

async function findPersistedAnswer(
  db: D1Client,
  responseId: string,
  surveyQuestionId: string,
): Promise<PersistedAnswer | undefined> {
  return await db
    .select({
      surveyQuestionId: surveyAnswers.surveyQuestionId,
      questionId: surveyAnswers.questionId,
      questionVersion: surveyAnswers.questionVersion,
      choiceId: surveyAnswers.choiceId,
      acceptedAt: surveyAnswers.acceptedAt,
    })
    .from(surveyAnswers)
    .where(
      and(
        eq(surveyAnswers.surveyResponseId, responseId),
        eq(surveyAnswers.surveyQuestionId, surveyQuestionId),
        eq(surveyAnswers.isDeleted, false),
      ),
    )
    .get();
}

async function buildSaveResult(
  db: D1Client,
  surveyId: string,
  responseId: string,
  answer: PersistedAnswer,
  outcome: "created" | "unchanged",
): Promise<SaveSurveyAnswerResult> {
  const [questionCountRow, answeredCountRow] = await Promise.all([
    db
      .select({ value: count(surveyQuestions.id) })
      .from(surveyQuestions)
      .where(and(eq(surveyQuestions.surveyId, surveyId), eq(surveyQuestions.isDeleted, false)))
      .get(),
    db
      .select({ value: count(surveyAnswers.id) })
      .from(surveyAnswers)
      .innerJoin(
        surveyQuestions,
        and(
          eq(surveyQuestions.id, surveyAnswers.surveyQuestionId),
          eq(surveyQuestions.surveyId, surveyId),
          eq(surveyQuestions.isDeleted, false),
        ),
      )
      .where(
        and(eq(surveyAnswers.surveyResponseId, responseId), eq(surveyAnswers.isDeleted, false)),
      )
      .get(),
  ]);
  const questionCount = questionCountRow?.value ?? 0;
  const answeredCount = answeredCountRow?.value ?? 0;
  const responseStatus: SurveyListResponseStatus =
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
 * 受付中Surveyの1問へ初回回答を保存します。
 * SurveyResponse・Source Record・AnswerはD1 batchで原子的に作成します。
 */
export async function saveSurveyAnswer(
  db: D1Client,
  input: {
    accountId: string;
    surveyId: string;
    surveyQuestionId: string;
    choiceId: string;
    at: Date;
  },
): Promise<SaveSurveyAnswerResult> {
  const survey = await db
    .select({
      state: surveys.state,
      opensAt: surveys.opensAt,
      closesAt: surveys.closesAt,
      isDeleted: surveys.isDeleted,
    })
    .from(surveys)
    .where(eq(surveys.id, input.surveyId))
    .get();
  if (
    !survey ||
    survey.isDeleted ||
    survey.state !== "published" ||
    survey.opensAt.getTime() > input.at.getTime()
  ) {
    return { type: "survey-not-found" };
  }
  if (survey.closesAt && survey.closesAt.getTime() <= input.at.getTime()) {
    return { type: "survey-closed" };
  }

  const surveyQuestion = await db
    .select({
      id: surveyQuestions.id,
      questionId: surveyQuestions.questionId,
      questionVersion: surveyQuestions.questionVersion,
    })
    .from(surveyQuestions)
    .innerJoin(
      questionRoots,
      and(eq(questionRoots.id, surveyQuestions.questionId), eq(questionRoots.isDeleted, false)),
    )
    .innerJoin(
      questionVersions,
      and(
        eq(questionVersions.questionId, surveyQuestions.questionId),
        eq(questionVersions.version, surveyQuestions.questionVersion),
        eq(questionVersions.isDeleted, false),
      ),
    )
    .where(
      and(
        eq(surveyQuestions.id, input.surveyQuestionId),
        eq(surveyQuestions.surveyId, input.surveyId),
        eq(surveyQuestions.isDeleted, false),
      ),
    )
    .get();
  if (!surveyQuestion) {
    return { type: "survey-question-not-found" };
  }

  const choice = await db
    .select({ id: questionChoices.choiceId })
    .from(questionChoices)
    .where(
      and(
        eq(questionChoices.questionId, surveyQuestion.questionId),
        eq(questionChoices.questionVersion, surveyQuestion.questionVersion),
        eq(questionChoices.choiceId, input.choiceId),
        eq(questionChoices.isDeleted, false),
      ),
    )
    .get();
  if (!choice) {
    return { type: "choice-not-found" };
  }

  const observedResponseId = await findSurveyResponseId(db, input.accountId, input.surveyId);
  if (observedResponseId) {
    const existing = await findPersistedAnswer(db, observedResponseId, input.surveyQuestionId);
    if (existing) {
      return existing.choiceId === input.choiceId
        ? buildSaveResult(db, input.surveyId, observedResponseId, existing, "unchanged")
        : { type: "answer-conflict" };
    }
  }

  const responseId = observedResponseId ?? crypto.randomUUID();
  const sourceRecordId = crypto.randomUUID();
  const answerId = crypto.randomUUID();
  // D1のtimestamp modeは秒精度なので、初回レスポンスと再送レスポンスを同じ値に揃えます。
  const acceptedAt = new Date(Math.floor(input.at.getTime() / 1000) * 1000);
  const answer: PersistedAnswer = {
    surveyQuestionId: surveyQuestion.id,
    questionId: surveyQuestion.questionId,
    questionVersion: surveyQuestion.questionVersion,
    choiceId: input.choiceId,
    acceptedAt,
  };

  try {
    await db.batch([
      db
        .insert(surveyResponses)
        .values({ id: responseId, accountId: input.accountId, surveyId: input.surveyId })
        .onConflictDoNothing(),
      db.insert(sourceRecords).values({
        id: sourceRecordId,
        accountId: input.accountId,
        kind: "user_input",
        accessLabel: "private",
      }),
      db.insert(surveyAnswers).values({
        id: answerId,
        surveyResponseId: responseId,
        surveyQuestionId: answer.surveyQuestionId,
        questionId: answer.questionId,
        questionVersion: answer.questionVersion,
        choiceId: answer.choiceId,
        acceptedAt: answer.acceptedAt,
        sourceRecordId,
      }),
      db
        .update(surveyDeferredQuestions)
        .set({ isDeleted: true, deletedAt: acceptedAt, updatedAt: acceptedAt })
        .where(
          and(
            eq(surveyDeferredQuestions.surveyResponseId, responseId),
            eq(surveyDeferredQuestions.surveyQuestionId, input.surveyQuestionId),
            eq(surveyDeferredQuestions.isDeleted, false),
          ),
        ),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const concurrentResponseId = await findSurveyResponseId(db, input.accountId, input.surveyId);
    const concurrent = concurrentResponseId
      ? await findPersistedAnswer(db, concurrentResponseId, input.surveyQuestionId)
      : undefined;
    if (!concurrent || !concurrentResponseId) {
      throw error;
    }
    return concurrent.choiceId === input.choiceId
      ? buildSaveResult(db, input.surveyId, concurrentResponseId, concurrent, "unchanged")
      : { type: "answer-conflict" };
  }

  return buildSaveResult(db, input.surveyId, responseId, answer, "created");
}

/**
 * 新規回答用のSurvey詳細を、Surveyが固定したQuestion Versionのまま取得します。
 * 非公開状態は存在有無を秘匿してnot-foundへ寄せ、受付終了だけを区別します。
 */
export async function findOpenSurveyDetail(
  db: D1Client,
  surveyId: string,
  at: Date,
): Promise<SurveyDetailResult> {
  const [survey] = await db
    .select({
      id: surveys.id,
      title: surveys.title,
      description: surveys.description,
      opensAt: surveys.opensAt,
      closesAt: surveys.closesAt,
      state: surveys.state,
      isDeleted: surveys.isDeleted,
    })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);

  if (
    !survey ||
    survey.isDeleted ||
    survey.state !== "published" ||
    survey.opensAt.getTime() > at.getTime()
  ) {
    return { type: "not-found" };
  }
  if (survey.closesAt && survey.closesAt.getTime() <= at.getTime()) {
    return { type: "closed" };
  }

  const rows = await db
    .select({
      surveyQuestionId: surveyQuestions.id,
      questionId: surveyQuestions.questionId,
      questionVersion: surveyQuestions.questionVersion,
      text: questionVersions.text,
      hint: questionVersions.hint,
      choiceId: questionChoices.choiceId,
      choiceLabel: questionChoices.label,
      choicePresentation: questionChoices.presentation,
    })
    .from(surveyQuestions)
    .innerJoin(
      questionRoots,
      and(eq(questionRoots.id, surveyQuestions.questionId), eq(questionRoots.isDeleted, false)),
    )
    .innerJoin(
      questionVersions,
      and(
        eq(questionVersions.questionId, surveyQuestions.questionId),
        eq(questionVersions.version, surveyQuestions.questionVersion),
        eq(questionVersions.isDeleted, false),
      ),
    )
    .innerJoin(
      questionChoices,
      and(
        eq(questionChoices.questionId, surveyQuestions.questionId),
        eq(questionChoices.questionVersion, surveyQuestions.questionVersion),
        eq(questionChoices.isDeleted, false),
      ),
    )
    .where(and(eq(surveyQuestions.surveyId, surveyId), eq(surveyQuestions.isDeleted, false)))
    .orderBy(asc(surveyQuestions.position), asc(questionChoices.position));

  const questions: SurveyDetail["questions"] = [];
  for (const row of rows) {
    const previous = questions.at(-1);
    const choice = {
      choiceId: row.choiceId,
      label: row.choiceLabel,
      presentation: row.choicePresentation ?? {},
    };
    if (previous?.surveyQuestionId === row.surveyQuestionId) {
      previous.choices.push(choice);
    } else {
      questions.push({
        surveyQuestionId: row.surveyQuestionId,
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
    survey: {
      id: survey.id,
      title: survey.title,
      description: survey.description,
      opensAt: survey.opensAt.toISOString(),
      closesAt: survey.closesAt?.toISOString() ?? null,
      questions,
    },
  };
}

/** 本人の現在有効な回答を、回答時点のQuestion VersionとChoiceで取得します。 */
export async function findSurveyAnswers(
  db: D1Client,
  accountId: string,
  surveyId: string,
  at: Date,
): Promise<SurveyAnswersResult> {
  const response = await db
    .select({
      responseId: surveyResponses.id,
      id: surveys.id,
      title: surveys.title,
      description: surveys.description,
      opensAt: surveys.opensAt,
      state: surveys.state,
      surveyIsDeleted: surveys.isDeleted,
    })
    .from(surveyResponses)
    .innerJoin(surveys, eq(surveys.id, surveyResponses.surveyId))
    .where(
      and(
        eq(surveyResponses.accountId, accountId),
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.isDeleted, false),
      ),
    )
    .get();

  if (
    !response ||
    response.surveyIsDeleted ||
    response.state !== "published" ||
    response.opensAt.getTime() > at.getTime()
  ) {
    return { type: "not-found" };
  }

  const [questionCountRow, rows] = await Promise.all([
    db
      .select({ value: count(surveyQuestions.id) })
      .from(surveyQuestions)
      .where(and(eq(surveyQuestions.surveyId, surveyId), eq(surveyQuestions.isDeleted, false)))
      .get(),
    db
      .select({
        surveyQuestionId: surveyAnswers.surveyQuestionId,
        questionId: surveyAnswers.questionId,
        questionVersion: surveyAnswers.questionVersion,
        questionText: questionVersions.text,
        choiceId: surveyAnswers.choiceId,
        choiceLabel: questionChoices.label,
        acceptedAt: surveyAnswers.acceptedAt,
      })
      .from(surveyAnswers)
      .innerJoin(
        surveyQuestions,
        and(
          eq(surveyQuestions.id, surveyAnswers.surveyQuestionId),
          eq(surveyQuestions.surveyId, surveyId),
        ),
      )
      .innerJoin(
        questionVersions,
        and(
          eq(questionVersions.questionId, surveyAnswers.questionId),
          eq(questionVersions.version, surveyAnswers.questionVersion),
        ),
      )
      .innerJoin(
        questionChoices,
        and(
          eq(questionChoices.questionId, surveyAnswers.questionId),
          eq(questionChoices.questionVersion, surveyAnswers.questionVersion),
          eq(questionChoices.choiceId, surveyAnswers.choiceId),
        ),
      )
      .where(
        and(
          eq(surveyAnswers.surveyResponseId, response.responseId),
          eq(surveyAnswers.isDeleted, false),
          eq(surveyQuestions.isDeleted, false),
        ),
      )
      .orderBy(asc(surveyQuestions.position)),
  ]);

  if (rows.length === 0) {
    return { type: "not-found" };
  }

  const questionCount = questionCountRow?.value ?? 0;
  const answeredCount = rows.length;
  return {
    type: "found",
    survey: {
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
 * 一覧へ表示できるSurveyと、指定Accountの現在の回答進捗を取得します。
 *
 * 公開前・公開停止・削除済みは含めません。受付終了後は回答内容への導線を残すため
 * `closed`として含めます。回答状態は現在有効なAnswerの件数から導出します。
 */
export async function listVisibleSurveys(
  db: D1Client,
  accountId: string,
  at: Date,
): Promise<SurveyListItem[]> {
  const rows = await db
    .select({
      id: surveys.id,
      title: surveys.title,
      description: surveys.description,
      opensAt: surveys.opensAt,
      closesAt: surveys.closesAt,
      questionCount: count(surveyQuestions.id),
      answeredCount: count(surveyAnswers.id),
    })
    .from(surveys)
    .innerJoin(
      surveyQuestions,
      and(eq(surveyQuestions.surveyId, surveys.id), eq(surveyQuestions.isDeleted, false)),
    )
    .leftJoin(
      surveyResponses,
      and(
        eq(surveyResponses.surveyId, surveys.id),
        eq(surveyResponses.accountId, accountId),
        eq(surveyResponses.isDeleted, false),
      ),
    )
    .leftJoin(
      surveyAnswers,
      and(
        eq(surveyAnswers.surveyResponseId, surveyResponses.id),
        eq(surveyAnswers.surveyQuestionId, surveyQuestions.id),
        eq(surveyAnswers.isDeleted, false),
      ),
    )
    .where(
      and(eq(surveys.state, "published"), eq(surveys.isDeleted, false), lte(surveys.opensAt, at)),
    )
    .groupBy(
      surveys.id,
      surveys.title,
      surveys.description,
      surveys.opensAt,
      surveys.closesAt,
      surveys.publishedAt,
    )
    .orderBy(desc(surveys.publishedAt), asc(surveys.id));

  return rows.map((row) => {
    const responseStatus: SurveyListResponseStatus =
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
