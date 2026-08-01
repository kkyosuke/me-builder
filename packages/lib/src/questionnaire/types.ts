/** Questionnaire domain で共通して使う失敗理由。 */
export type QuestionnaireErrorCode =
  | "invalid-input"
  | "invalid-transition"
  | "question-version-not-found"
  | "question-version-not-approved"
  | "survey-question-not-found"
  | "choice-not-found"
  | "survey-not-open"
  | "account-inactive"
  | "response-owner-mismatch"
  | "response-survey-mismatch"
  | "question-already-answered";

export type QuestionnaireError = {
  code: QuestionnaireErrorCode;
  message: string;
};

/** 例外ではなく判別可能な union でドメイン上の成否を返します。 */
export type QuestionnaireResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: QuestionnaireError };

export function success<T>(value: T): QuestionnaireResult<T> {
  return { ok: true, value };
}

export function failure<T>(code: QuestionnaireErrorCode, message: string): QuestionnaireResult<T> {
  return { ok: false, error: { code, message } };
}

export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}
