import * as v from "valibot";
import type { operations } from "../../../generated/api";
import {
  AuthenticationError,
  OperationError,
  UnknownError,
  ValidationError,
} from "../../../infrastructure/errors";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import type { DiagnosisDefinition } from "../model/diagnosis-definition";
import type { DiagnosisListItem } from "../model/diagnosis-list-item";
import type { DiagnosisResult } from "../model/diagnosis-result";
import { relationshipCategoryValues } from "../model/relationship-category";
import { DiagnosisQuestionsSchema } from "../model/types";

type ApiDiagnosisListResponse =
  operations["listDiagnoses"]["responses"][200]["content"]["application/json"];
type ApiDiagnosisListItem = ApiDiagnosisListResponse["diagnoses"][number];
type ApiDiagnosisDetailResponse =
  operations["getDiagnosisDetail"]["responses"][200]["content"]["application/json"];
type ApiSaveDiagnosisAnswerResponse =
  operations["saveDiagnosisAnswer"]["responses"][200]["content"]["application/json"];
type ApiDeferDiagnosisQuestionResponse =
  operations["deferDiagnosisQuestion"]["responses"][200]["content"]["application/json"];
type ApiDiagnosisAnswersResponse =
  operations["getDiagnosisAnswers"]["responses"][200]["content"]["application/json"];

const DiagnosisListItemSchema = v.object({
  id: v.pipe(v.string(), v.nonEmpty()),
  title: v.pipe(v.string(), v.nonEmpty()),
  description: v.pipe(v.string(), v.nonEmpty()),
  relationshipCategory: v.picklist(relationshipCategoryValues),
  opensAt: v.pipe(v.string(), v.isoTimestamp()),
  closesAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  displayOrder: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  availability: v.picklist(["open", "closed"]),
  responseStatus: v.picklist(["unanswered", "in-progress", "answered"]),
  answeredCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  questionCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  lastAnsweredAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
});

const DiagnosisListResponseSchema = v.object({
  diagnoses: v.array(DiagnosisListItemSchema),
}) satisfies v.GenericSchema<ApiDiagnosisListResponse>;

const toDiagnosisListItem = (item: ApiDiagnosisListItem): DiagnosisListItem => ({
  id: item.id,
  title: item.title,
  description: item.description,
  relationshipCategory: item.relationshipCategory,
  opensAt: item.opensAt,
  closesAt: item.closesAt,
  displayOrder: item.displayOrder,
  availability: item.availability,
  responseStatus: item.responseStatus,
  answeredCount: item.answeredCount,
  questionCount: item.questionCount,
  lastAnsweredAt: item.lastAnsweredAt,
});

/** application sessionで本人確認し、回答進捗を含む診断一覧を取得する。 */
export async function fetchDiagnosisList(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<DiagnosisListItem[]> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/diagnoses", {
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("診断を利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    throw new Error(`診断一覧の取得に失敗しました (HTTP ${response.status})`);
  }

  const body: ApiDiagnosisListResponse = v.parse(
    DiagnosisListResponseSchema,
    await response.json(),
  );
  return body.diagnoses.map(toDiagnosisListItem);
}

const ApiDiagnosisDetailSchema = v.object({
  id: v.pipe(v.string(), v.nonEmpty()),
  title: v.pipe(v.string(), v.nonEmpty()),
  description: v.pipe(v.string(), v.nonEmpty()),
  relationshipCategory: v.picklist(relationshipCategoryValues),
  opensAt: v.pipe(v.string(), v.isoTimestamp()),
  closesAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  questions: v.array(
    v.object({
      diagnosisQuestionId: v.pipe(v.string(), v.nonEmpty()),
      questionId: v.pipe(v.string(), v.nonEmpty()),
      questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
      text: v.pipe(v.string(), v.nonEmpty()),
      hint: v.nullable(v.pipe(v.string(), v.nonEmpty())),
      backsideOfDiagnosisQuestionId: v.nullable(v.pipe(v.string(), v.nonEmpty())),
      format: v.picklist(["single_choice", "likert_5"]),
      choices: v.pipe(
        v.array(
          v.object({
            choiceId: v.pipe(v.string(), v.nonEmpty()),
            label: v.pipe(v.string(), v.nonEmpty()),
            score: v.nullable(v.number()),
          }),
        ),
        v.minLength(2),
        v.maxLength(5),
      ),
    }),
  ),
}) satisfies v.GenericSchema<ApiDiagnosisDetailResponse>;

/** application sessionで本人確認し、D1で公開された質問を回答画面の定義へ変換する。 */
export async function fetchDiagnosisDefinition(
  apiUrl: string | undefined,
  diagnosisId: string,
  signal?: AbortSignal,
): Promise<DiagnosisDefinition> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/diagnoses/${encodeURIComponent(diagnosisId)}`,
    {
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
      throw new OperationError("この診断は現在公開されていません。", {
        code: "DIAGNOSIS_UNAVAILABLE",
        status: response.status,
      });
    }
    if (response.status === 409) {
      throw new OperationError("受付終了のため、新しい回答は開始できません。", {
        code: "DIAGNOSIS_CLOSED",
        status: response.status,
      });
    }
    throw new UnknownError(`診断詳細の取得に失敗しました (HTTP ${response.status})`, {
      code: "DIAGNOSIS_DETAIL_REQUEST_FAILED",
      status: response.status,
    });
  }

  let body: ApiDiagnosisDetailResponse;
  try {
    body = v.parse(ApiDiagnosisDetailSchema, await response.json());
  } catch (error) {
    throw new ValidationError("診断詳細のレスポンスが不正です。", {
      code: "DIAGNOSIS_DETAIL_INVALID_RESPONSE",
      cause: error,
    });
  }

  let questions: DiagnosisDefinition["questions"];
  try {
    questions = v.parse(
      DiagnosisQuestionsSchema,
      body.questions.map((question) => {
        if (question.format === "likert_5") {
          if (question.choices.length !== 5) {
            throw new Error("5段階診断の選択肢数が不正です。");
          }
          return {
            diagnosisQuestionId: question.diagnosisQuestionId,
            questionId: question.questionId,
            questionVersion: question.questionVersion,
            text: question.text,
            ...(question.hint ? { hint: question.hint } : {}),
            format: "likert_5" as const,
            choices: question.choices,
          };
        }
        const [left, right] = question.choices;
        if (!left || !right) {
          throw new Error("診断の選択肢が不足しています。");
        }
        return {
          diagnosisQuestionId: question.diagnosisQuestionId,
          questionId: question.questionId,
          questionVersion: question.questionVersion,
          text: question.text,
          ...(question.hint ? { hint: question.hint } : {}),
          ...(question.backsideOfDiagnosisQuestionId
            ? { backsideOfDiagnosisQuestionId: question.backsideOfDiagnosisQuestionId }
            : {}),
          format: "single_choice" as const,
          left: {
            choiceId: left.choiceId,
            label: left.label,
          },
          right: {
            choiceId: right.choiceId,
            label: right.label,
          },
        };
      }),
    );
  } catch (error) {
    throw new ValidationError("診断詳細を回答画面の形式へ変換できません。", {
      code: "DIAGNOSIS_DETAIL_INVALID_RESPONSE",
      cause: error,
    });
  }

  return {
    id: body.id,
    title: body.title,
    description: body.description,
    relationshipCategory: body.relationshipCategory,
    questions,
  };
}

const SaveDiagnosisAnswerResponseSchema = v.object({
  outcome: v.picklist(["created", "unchanged"]),
  answer: v.object({
    diagnosisQuestionId: v.pipe(v.string(), v.nonEmpty()),
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
}) satisfies v.GenericSchema<ApiSaveDiagnosisAnswerResponse>;

export type SaveDiagnosisAnswerResult = v.InferOutput<typeof SaveDiagnosisAnswerResponseSchema>;

/** 1問分のChoice IDを保存し、サーバーが確定した回答時点と最新進捗を返す。 */
export async function saveDiagnosisAnswer(
  apiUrl: string | undefined,
  diagnosisId: string,
  diagnosisQuestionId: string,
  choiceId: string,
  options: { keepalive?: boolean; signal?: AbortSignal } = {},
): Promise<SaveDiagnosisAnswerResult> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/diagnoses/${encodeURIComponent(diagnosisId)}/answers/${encodeURIComponent(diagnosisQuestionId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ choiceId }),
      ...(options.keepalive ? { keepalive: true } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
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
      throw new OperationError("この診断は現在公開されていません。", {
        code: "DIAGNOSIS_UNAVAILABLE",
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
        reason === "answer_is_immutable"
          ? "保存済みの診断回答は変更できません。"
          : "受付終了のため、回答を保存できませんでした。",
        {
          code: reason === "answer_is_immutable" ? "ANSWER_CONFLICT" : "DIAGNOSIS_CLOSED",
          status: response.status,
        },
      );
    }
    if (response.status === 422) {
      throw new ValidationError("選択した回答はこの診断では利用できません。", {
        code: "INVALID_DIAGNOSIS_ANSWER",
        status: response.status,
      });
    }
    throw new UnknownError(`回答の保存に失敗しました (HTTP ${response.status})`, {
      code: "DIAGNOSIS_ANSWER_REQUEST_FAILED",
      status: response.status,
    });
  }

  try {
    return v.parse(SaveDiagnosisAnswerResponseSchema, await response.json());
  } catch (error) {
    throw new ValidationError("回答保存のレスポンスが不正です。", {
      code: "DIAGNOSIS_ANSWER_INVALID_RESPONSE",
      cause: error,
    });
  }
}

const DeferDiagnosisQuestionResponseSchema = v.object({
  outcome: v.picklist(["created", "unchanged"]),
  deferredQuestion: v.object({
    diagnosisQuestionId: v.pipe(v.string(), v.nonEmpty()),
    deferredAt: v.pipe(v.string(), v.isoTimestamp()),
  }),
}) satisfies v.GenericSchema<ApiDeferDiagnosisQuestionResponse>;

/** 未回答の1問を「あとで回答」として保存する。 */
export async function deferDiagnosisQuestion(
  apiUrl: string | undefined,
  diagnosisId: string,
  diagnosisQuestionId: string,
  signal?: AbortSignal,
): Promise<ApiDeferDiagnosisQuestionResponse> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/diagnoses/${encodeURIComponent(diagnosisId)}/deferred-questions/${encodeURIComponent(diagnosisQuestionId)}`,
    {
      method: "PUT",
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
      throw new OperationError("この診断は現在公開されていません。", {
        code: "DIAGNOSIS_UNAVAILABLE",
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
        reason === "question_already_answered"
          ? "この質問にはすでに回答済みです。一覧から開き直してください。"
          : "受付終了のため、あとで回答を保存できませんでした。",
        {
          code: reason === "question_already_answered" ? "ANSWER_CONFLICT" : "DIAGNOSIS_CLOSED",
          status: response.status,
        },
      );
    }
    if (response.status === 422) {
      throw new ValidationError("この質問はあとで回答にできません。", {
        code: "INVALID_DIAGNOSIS_QUESTION",
        status: response.status,
      });
    }
    throw new UnknownError(`あとで回答の保存に失敗しました (HTTP ${response.status})`, {
      code: "DIAGNOSIS_DEFER_REQUEST_FAILED",
      status: response.status,
    });
  }

  try {
    return v.parse(DeferDiagnosisQuestionResponseSchema, await response.json());
  } catch (error) {
    throw new ValidationError("あとで回答のレスポンスが不正です。", {
      code: "DIAGNOSIS_DEFER_INVALID_RESPONSE",
      cause: error,
    });
  }
}

const DiagnosisAnswersResponseSchema = v.object({
  id: v.pipe(v.string(), v.nonEmpty()),
  title: v.pipe(v.string(), v.nonEmpty()),
  description: v.pipe(v.string(), v.nonEmpty()),
  relationshipCategory: v.picklist(relationshipCategoryValues),
  responseStatus: v.picklist(["in-progress", "answered"]),
  answeredCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  questionCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  answers: v.pipe(
    v.array(
      v.object({
        diagnosisQuestionId: v.pipe(v.string(), v.nonEmpty()),
        questionId: v.pipe(v.string(), v.nonEmpty()),
        questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
        questionText: v.pipe(v.string(), v.nonEmpty()),
        choiceId: v.pipe(v.string(), v.nonEmpty()),
        choiceLabel: v.pipe(v.string(), v.nonEmpty()),
        acceptedAt: v.pipe(v.string(), v.isoTimestamp()),
        perspective: v.picklist(["single", "behavior", "desired"]),
        pairId: v.nullable(v.pipe(v.string(), v.nonEmpty())),
      }),
    ),
    v.minLength(1),
  ),
  scoring: v.nullable(
    v.object({
      scoringVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
      balancedLabel: v.pipe(v.string(), v.nonEmpty()),
      parameters: v.pipe(
        v.array(
          v.object({
            id: v.pipe(v.string(), v.nonEmpty()),
            label: v.pipe(v.string(), v.nonEmpty()),
            lowLabel: v.pipe(v.string(), v.nonEmpty()),
            highLabel: v.pipe(v.string(), v.nonEmpty()),
            resultKind: v.picklist(["aggregate", "behavior_desired"]),
            score: v.nullable(v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100))),
            coverage: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
            band: v.picklist(["low", "balanced", "high", "insufficient"]),
            behavior: v.nullable(
              v.object({
                score: v.nullable(
                  v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
                ),
                coverage: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
                band: v.picklist(["low", "balanced", "high", "insufficient"]),
              }),
            ),
            comparison: v.nullable(
              v.object({
                difference: v.pipe(v.number(), v.safeInteger(), v.minValue(-100), v.maxValue(100)),
                relation: v.picklist(["same_band", "desired_higher", "behavior_higher"]),
              }),
            ),
          }),
        ),
        v.minLength(1),
      ),
    }),
  ),
}) satisfies v.GenericSchema<ApiDiagnosisAnswersResponse>;

async function requestDiagnosisResult(
  apiUrl: string | undefined,
  diagnosisId: string,
  allowMissing: boolean,
  signal?: AbortSignal,
): Promise<DiagnosisResult | undefined> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/diagnoses/${encodeURIComponent(diagnosisId)}/answers`,
    {
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
      if (allowMissing) {
        return undefined;
      }
      throw new OperationError("保存済みの回答を確認できませんでした。", {
        code: "DIAGNOSIS_ANSWERS_NOT_FOUND",
        status: response.status,
      });
    }
    throw new UnknownError(`回答内容の取得に失敗しました (HTTP ${response.status})`, {
      code: "DIAGNOSIS_ANSWERS_REQUEST_FAILED",
      status: response.status,
    });
  }

  let body: ApiDiagnosisAnswersResponse;
  try {
    body = v.parse(DiagnosisAnswersResponseSchema, await response.json());
  } catch (error) {
    throw new ValidationError("回答内容のレスポンスが不正です。", {
      code: "DIAGNOSIS_ANSWERS_INVALID_RESPONSE",
      cause: error,
    });
  }

  return body;
}

/** 本人が保存した回答内容とAPIで計算済みの傾向を取得する。 */
export async function fetchDiagnosisResult(
  apiUrl: string | undefined,
  diagnosisId: string,
  signal?: AbortSignal,
): Promise<DiagnosisResult | undefined> {
  return requestDiagnosisResult(apiUrl, diagnosisId, false, signal);
}

/** 回答画面の開始時に現在回答を取得する。回答がまだなければ`undefined`を返す。 */
export async function fetchDiagnosisProgress(
  apiUrl: string | undefined,
  diagnosisId: string,
  signal?: AbortSignal,
): Promise<DiagnosisResult | undefined> {
  return requestDiagnosisResult(apiUrl, diagnosisId, true, signal);
}
