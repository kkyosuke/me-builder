import { and, asc, countDistinct, desc, eq, lte } from "drizzle-orm";
import type { D1Client } from "../client";
import { surveyAnswers, surveyQuestions, surveyResponses, surveys } from "../schema/questionnaire";

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
      questionCount: countDistinct(surveyQuestions.id),
      answeredCount: countDistinct(surveyAnswers.id),
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
