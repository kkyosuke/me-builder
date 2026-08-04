import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { SurveyDefinition } from "../model/survey-definition";
import { SurveyDetailError } from "../model/survey-detail-error";
import type { SurveyListItem } from "../model/survey-list-item";
import { SurveyQuestionsSchema } from "../model/types";
import { combineSurveyDefinition } from "./local-definitions";

type ApiSurveyListResponse =
  operations["listSurveys"]["responses"][200]["content"]["application/json"];
type ApiSurveyListItem = ApiSurveyListResponse["surveys"][number];
type ApiSurveyDetailResponse =
  operations["getSurveyDetail"]["responses"][200]["content"]["application/json"];

const SurveyListItemSchema = v.object({
  id: v.pipe(v.string(), v.nonEmpty()),
  title: v.pipe(v.string(), v.nonEmpty()),
  description: v.pipe(v.string(), v.nonEmpty()),
  opensAt: v.pipe(v.string(), v.isoTimestamp()),
  closesAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  availability: v.picklist(["open", "closed"]),
  responseStatus: v.picklist(["unanswered", "in-progress", "answered"]),
  answeredCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  questionCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});

const SurveyListResponseSchema = v.object({
  surveys: v.array(SurveyListItemSchema),
}) satisfies v.GenericSchema<ApiSurveyListResponse>;

const toSurveyListItem = (item: ApiSurveyListItem): SurveyListItem => ({
  id: item.id,
  title: item.title,
  description: item.description,
  opensAt: item.opensAt,
  closesAt: item.closesAt,
  availability: item.availability,
  responseStatus: item.responseStatus,
  answeredCount: item.answeredCount,
  questionCount: item.questionCount,
});

/** LIFF IDトークンで本人確認し、回答進捗を含むアンケート一覧を取得する。 */
export async function fetchSurveyList(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<SurveyListItem[]> {
  const response = await createHttpClient(apiUrl).request("/api/surveys", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("アンケートを利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    throw new Error(`アンケート一覧の取得に失敗しました (HTTP ${response.status})`);
  }

  const body: ApiSurveyListResponse = v.parse(SurveyListResponseSchema, await response.json());
  return body.surveys.map(toSurveyListItem);
}

const ApiSurveyDetailSchema = v.object({
  id: v.pipe(v.string(), v.nonEmpty()),
  title: v.pipe(v.string(), v.nonEmpty()),
  description: v.pipe(v.string(), v.nonEmpty()),
  opensAt: v.pipe(v.string(), v.isoTimestamp()),
  closesAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  questions: v.array(
    v.object({
      surveyQuestionId: v.pipe(v.string(), v.nonEmpty()),
      questionId: v.pipe(v.string(), v.nonEmpty()),
      questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
      text: v.pipe(v.string(), v.nonEmpty()),
      hint: v.nullable(v.pipe(v.string(), v.nonEmpty())),
      choices: v.pipe(
        v.array(
          v.object({
            choiceId: v.pipe(v.string(), v.nonEmpty()),
            label: v.pipe(v.string(), v.nonEmpty()),
            presentation: v.object({ icon: v.pipe(v.string(), v.nonEmpty()) }),
          }),
        ),
        v.length(2),
      ),
    }),
  ),
}) satisfies v.GenericSchema<ApiSurveyDetailResponse>;

/** LIFF IDトークンで本人確認し、D1で公開された質問を回答画面の定義へ変換する。 */
export async function fetchSurveyDefinition(
  apiUrl: string | undefined,
  idToken: string,
  surveyId: string,
  signal?: AbortSignal,
): Promise<SurveyDefinition | undefined> {
  const response = await createHttpClient(apiUrl).request(
    `/api/surveys/${encodeURIComponent(surveyId)}`,
    {
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    },
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new SurveyDetailError(
        "authentication-required",
        "本人確認に失敗しました。LINEから開き直してください。",
        { status: response.status },
      );
    }
    if (response.status === 404) {
      throw new SurveyDetailError(
        "survey-unavailable",
        "このアンケートは現在公開されていません。",
        { status: response.status },
      );
    }
    if (response.status === 409) {
      throw new SurveyDetailError(
        "operation-not-allowed",
        "受付終了のため、新しい回答は開始できません。",
        { status: response.status },
      );
    }
    throw new SurveyDetailError(
      "unknown",
      `アンケート詳細の取得に失敗しました (HTTP ${response.status})`,
      { status: response.status },
    );
  }

  let body: ApiSurveyDetailResponse;
  try {
    body = v.parse(ApiSurveyDetailSchema, await response.json());
  } catch (error) {
    throw new SurveyDetailError("invalid-response", "アンケート詳細のレスポンスが不正です。", {
      cause: error,
    });
  }

  let questions: SurveyDefinition["questions"];
  try {
    questions = v.parse(
      SurveyQuestionsSchema,
      body.questions.map((question) => {
        const [left, right] = question.choices;
        if (!left || !right) {
          throw new Error("アンケートの選択肢が不足しています。");
        }
        return {
          surveyQuestionId: question.surveyQuestionId,
          questionId: question.questionId,
          questionVersion: question.questionVersion,
          text: question.text,
          ...(question.hint ? { hint: question.hint } : {}),
          left: {
            choiceId: left.choiceId,
            label: left.label,
            icon: left.presentation.icon,
          },
          right: {
            choiceId: right.choiceId,
            label: right.label,
            icon: right.presentation.icon,
          },
        };
      }),
    );
  } catch (error) {
    throw new SurveyDetailError(
      "invalid-response",
      "アンケート詳細を回答画面の形式へ変換できません。",
      { cause: error },
    );
  }

  return combineSurveyDefinition({
    id: body.id,
    title: body.title,
    description: body.description,
    questions,
  });
}
