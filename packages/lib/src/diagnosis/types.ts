import * as v from "valibot";

/** Diagnosis domain で共通して使う失敗理由。 */
export type DiagnosisErrorCode =
  | "invalid-input"
  | "invalid-transition"
  | "question-version-not-found"
  | "question-version-not-approved"
  | "diagnosis-question-not-found"
  | "choice-not-found"
  | "diagnosis-not-open"
  | "account-inactive"
  | "response-owner-mismatch"
  | "response-diagnosis-mismatch"
  | "question-already-answered";

export type DiagnosisError = {
  code: DiagnosisErrorCode;
  message: string;
};

/** 例外ではなく判別可能な union でドメイン上の成否を返します。 */
export type DiagnosisResult<T> = { ok: true; value: T } | { ok: false; error: DiagnosisError };

export function success<T>(value: T): DiagnosisResult<T> {
  return { ok: true, value };
}

export function failure<T>(code: DiagnosisErrorCode, message: string): DiagnosisResult<T> {
  return { ok: false, error: { code, message } };
}

export function validate<TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
): DiagnosisResult<v.InferOutput<TSchema>> {
  const result = v.safeParse(schema, input);
  if (!result.success) {
    return failure("invalid-input", result.issues[0]?.message ?? "入力値が不正です");
  }
  return success(result.output);
}
