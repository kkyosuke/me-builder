import * as v from "valibot";
import type { operations } from "../../../generated/api";
import {
  AuthenticationError,
  OperationError,
  UnknownError,
  ValidationError,
} from "../../../infrastructure/errors";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { SurveyDefinition } from "../model/survey-definition";
import type { SurveyListItem } from "../model/survey-list-item";
import { SurveyQuestionsSchema } from "../model/types";
import { combineSurveyDefinition } from "./local-definitions";

type ApiSurveyListResponse =
  operations["listSurveys"]["responses"][200]["content"]["application/json"];
type ApiSurveyListItem = ApiSurveyListResponse["surveys"][number];
type ApiSurveyDetailResponse =
  operations["getSurveyDetail"]["responses"][200]["content"]["application/json"];
type ApiSaveSurveyAnswerResponse =
  operations["saveSurveyAnswer"]["responses"][200]["content"]["application/json"];

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
      throw new AuthenticationError("本人確認に失敗しました。LINEから開き直してください。", {
        code: "AUTHENTICATION_REQUIRED",
        status: response.status,
      });
    }
    if (response.status === 404) {
      throw new OperationError("このアンケートは現在公開されていません。", {
        code: "SURVEY_UNAVAILABLE",
        status: response.status,
      });
    }
    if (response.status === 409) {
      throw new OperationError("受付終了のため、新しい回答は開始できません。", {
        code: "SURVEY_CLOSED",
        status: response.status,
      });
    }
    throw new UnknownError(`アンケート詳細の取得に失敗しました (HTTP ${response.status})`, {
      code: "SURVEY_DETAIL_REQUEST_FAILED",
      status: response.status,
    });
  }

  let body: ApiSurveyDetailResponse;
  try {
    body = v.parse(ApiSurveyDetailSchema, await response.json());
  } catch (error) {
    throw new ValidationError("アンケート詳細のレスポンスが不正です。", {
      code: "SURVEY_DETAIL_INVALID_RESPONSE",
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
    throw new ValidationError("アンケート詳細を回答画面の形式へ変換できません。", {
      code: "SURVEY_DETAIL_INVALID_RESPONSE",
      cause: error,
    });
  }

  return combineSurveyDefinition({
    id: body.id,
    title: body.title,
    description: body.description,
    questions,
  });
}

const SaveSurveyAnswerResponseSchema = v.object({
  outcome: v.picklist(["created", "unchanged"]),
  answer: v.object({
    surveyQuestionId: v.pipe(v.string(), v.nonEmpty()),
    questionId: v.pipe(v.string(), v.nonEmpty()),
    questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    choiceId: v.pipe(v.string(), v.nonEmpty()),
    acceptedAt: v.pipe(v.string(), v.isoTimestamp()),
  }),
  progress: v.object({
    responseStatus: v.picklist(["unanswered", "in-progress", "answered"]),
    answeredCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    questionCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  }),
}) satisfies v.GenericSchema<ApiSaveSurveyAnswerResponse>;

export type SaveSurveyAnswerResult = v.InferOutput<typeof SaveSurveyAnswerResponseSchema>;

/** 1問分のChoice IDを保存し、サーバーが確定した回答時点と最新進捗を返す。 */
export async function saveSurveyAnswer(
  apiUrl: string | undefined,
  idToken: string,
  surveyId: string,
  surveyQuestionId: string,
  choiceId: string,
  signal?: AbortSignal,
): Promise<SaveSurveyAnswerResult> {
  const response = await createHttpClient(apiUrl).request(
    `/api/surveys/${encodeURIComponent(surveyId)}/answers/${encodeURIComponent(surveyQuestionId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ choiceId }),
      ...(signal ? { signal } : {}),
    },
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthenticationError("本人確認に失敗しました。LINEから開き直してください。", {
        code: "AUTHENTICATION_REQUIRED",
        status: response.status,
      });
    }
    if (response.status === 404) {
      throw new OperationError("このアンケートは現在公開されていません。", {
        code: "SURVEY_UNAVAILABLE",
        status: response.status,
      });
    }
    if (response.status === 409) {
      let reason: string | undefined;
      try {
        reason = ((await response.json()) as { reason?: string }).reason;
      } catch {
        // エラー本文が壊れていてもHTTP statusから安全な案内へ変換します。
      }
      throw new OperationError(
        reason === "answer_change_requires_revision"
          ? "すでに別の回答が保存されています。回答の修正機能をお待ちください。"
          : "受付終了のため、回答を保存できませんでした。",
        {
          code: reason === "answer_change_requires_revision" ? "ANSWER_CONFLICT" : "SURVEY_CLOSED",
          status: response.status,
        },
      );
    }
    if (response.status === 422) {
      throw new ValidationError("選択した回答はこのアンケートでは利用できません。", {
        code: "INVALID_SURVEY_ANSWER",
        status: response.status,
      });
    }
    throw new UnknownError(`回答の保存に失敗しました (HTTP ${response.status})`, {
      code: "SURVEY_ANSWER_REQUEST_FAILED",
      status: response.status,
    });
  }

  try {
    return v.parse(SaveSurveyAnswerResponseSchema, await response.json());
  } catch (error) {
    throw new ValidationError("回答保存のレスポンスが不正です。", {
      code: "SURVEY_ANSWER_INVALID_RESPONSE",
      cause: error,
    });
  }
}
