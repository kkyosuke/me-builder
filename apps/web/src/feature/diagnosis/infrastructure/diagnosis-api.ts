import * as v from "valibot";
import type { operations } from "../../../generated/api";
import {
  AuthenticationError,
  OperationError,
  UnknownError,
  ValidationError,
} from "../../../infrastructure/errors";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { DiagnosisDefinition } from "../model/diagnosis-definition";
import type { DiagnosisListItem } from "../model/diagnosis-list-item";
import type { DiagnosisResult } from "../model/diagnosis-result";
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
  opensAt: item.opensAt,
  closesAt: item.closesAt,
  displayOrder: item.displayOrder,
  availability: item.availability,
  responseStatus: item.responseStatus,
  answeredCount: item.answeredCount,
  questionCount: item.questionCount,
  lastAnsweredAt: item.lastAnsweredAt,
});

/** LIFF IDトークンで本人確認し、回答進捗を含む診断一覧を取得する。 */
export async function fetchDiagnosisList(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<DiagnosisListItem[]> {
  const response = await createHttpClient(apiUrl).request("/api/diagnoses", {
    headers: { Authorization: `Bearer ${idToken}` },
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
  opensAt: v.pipe(v.string(), v.isoTimestamp()),
  closesAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  questions: v.array(
    v.object({
      diagnosisQuestionId: v.pipe(v.string(), v.nonEmpty()),
      questionId: v.pipe(v.string(), v.nonEmpty()),
      questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
      text: v.pipe(v.string(), v.nonEmpty()),
      hint: v.nullable(v.pipe(v.string(), v.nonEmpty())),
      choices: v.pipe(
        v.array(
          v.object({
            choiceId: v.pipe(v.string(), v.nonEmpty()),
            label: v.pipe(v.string(), v.nonEmpty()),
          }),
        ),
        v.length(2),
      ),
    }),
  ),
}) satisfies v.GenericSchema<ApiDiagnosisDetailResponse>;

/** LIFF IDトークンで本人確認し、D1で公開された質問を回答画面の定義へ変換する。 */
export async function fetchDiagnosisDefinition(
  apiUrl: string | undefined,
  idToken: string,
  diagnosisId: string,
  signal?: AbortSignal,
): Promise<DiagnosisDefinition> {
  const response = await createHttpClient(apiUrl).request(
    `/api/diagnoses/${encodeURIComponent(diagnosisId)}`,
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
  idToken: string,
  diagnosisId: string,
  diagnosisQuestionId: string,
  choiceId: string,
  signal?: AbortSignal,
): Promise<SaveDiagnosisAnswerResult> {
  const response = await createHttpClient(apiUrl).request(
    `/api/diagnoses/${encodeURIComponent(diagnosisId)}/answers/${encodeURIComponent(diagnosisQuestionId)}`,
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
        reason === "answer_change_requires_revision"
          ? "すでに別の回答が保存されています。回答の修正機能をお待ちください。"
          : "受付終了のため、回答を保存できませんでした。",
        {
          code:
            reason === "answer_change_requires_revision" ? "ANSWER_CONFLICT" : "DIAGNOSIS_CLOSED",
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
  idToken: string,
  diagnosisId: string,
  diagnosisQuestionId: string,
  signal?: AbortSignal,
): Promise<ApiDeferDiagnosisQuestionResponse> {
  const response = await createHttpClient(apiUrl).request(
    `/api/diagnoses/${encodeURIComponent(diagnosisId)}/deferred-questions/${encodeURIComponent(diagnosisQuestionId)}`,
    {
      method: "PUT",
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
            score: v.nullable(v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100))),
            coverage: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
            band: v.picklist(["low", "balanced", "high", "insufficient"]),
          }),
        ),
        v.minLength(1),
      ),
    }),
  ),
}) satisfies v.GenericSchema<ApiDiagnosisAnswersResponse>;

async function requestDiagnosisResult(
  apiUrl: string | undefined,
  idToken: string,
  diagnosisId: string,
  allowMissing: boolean,
  signal?: AbortSignal,
): Promise<DiagnosisResult | undefined> {
  const response = await createHttpClient(apiUrl).request(
    `/api/diagnoses/${encodeURIComponent(diagnosisId)}/answers`,
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
  idToken: string,
  diagnosisId: string,
  signal?: AbortSignal,
): Promise<DiagnosisResult | undefined> {
  return requestDiagnosisResult(apiUrl, idToken, diagnosisId, false, signal);
}

/** 回答画面の開始時に現在回答を取得する。回答がまだなければ`undefined`を返す。 */
export async function fetchDiagnosisProgress(
  apiUrl: string | undefined,
  idToken: string,
  diagnosisId: string,
  signal?: AbortSignal,
): Promise<DiagnosisResult | undefined> {
  return requestDiagnosisResult(apiUrl, idToken, diagnosisId, true, signal);
}
