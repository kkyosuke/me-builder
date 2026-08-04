import { and, asc, count, desc, eq, lte } from "drizzle-orm";
import type { D1Client } from "../client";
import {
  questionChoices,
  questions as questionRoots,
  questionVersions,
  surveyAnswers,
  surveyQuestions,
  surveyResponses,
  surveys,
} from "../schema/questionnaire";

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
