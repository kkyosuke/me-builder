import * as v from "valibot";
import {
  AuthenticationError,
  OperationError,
  UnknownError,
  ValidationError,
} from "../../../infrastructure/errors";
import { createHttpClient } from "../../../infrastructure/http-client";

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const ResetDevelopmentAccountDataResponseSchema = v.object({
  deletedDiagnosisResponseCount: CountSchema,
  deletedConversationSessionCount: CountSchema,
  deletedSourceRecordCount: CountSchema,
  deletedBrainItemCount: CountSchema,
  deletedProfileSummaryVersionCount: CountSchema,
  scheduledVectorDeletionCount: CountSchema,
});

export type ResetDevelopmentAccountDataResult = v.InferOutput<
  typeof ResetDevelopmentAccountDataResponseSchema
>;

export async function resetDevelopmentAccountData(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<ResetDevelopmentAccountDataResult> {
  const response = await createHttpClient(apiUrl).request("/api/dev/account-data", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthenticationError("本人確認に失敗しました。LINEから開き直してください。", {
        code: "AUTHENTICATION_REQUIRED",
        status: response.status,
      });
    }
    if (response.status === 404) {
      throw new OperationError("この環境では本人データを削除できません。", {
        code: "DEVELOPMENT_RESET_UNAVAILABLE",
        status: response.status,
      });
    }
    throw new UnknownError(`本人データの削除に失敗しました (HTTP ${response.status})`, {
      code: "DEVELOPMENT_RESET_REQUEST_FAILED",
      status: response.status,
    });
  }
  try {
    return v.parse(ResetDevelopmentAccountDataResponseSchema, await response.json());
  } catch (error) {
    throw new ValidationError("本人データ削除のレスポンスが不正です。", {
      code: "DEVELOPMENT_RESET_INVALID_RESPONSE",
      cause: error,
    });
  }
}
