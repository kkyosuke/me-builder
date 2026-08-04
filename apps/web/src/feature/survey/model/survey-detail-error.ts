export type SurveyDetailErrorReason =
  | "authentication-required"
  | "survey-unavailable"
  | "operation-not-allowed"
  | "invalid-response"
  | "unknown";

/** 詳細取得の失敗理由をUIへ渡し、HTTPステータスや文言の判定をpresentationへ漏らさない。 */
export class SurveyDetailError extends Error {
  readonly reason: SurveyDetailErrorReason;
  readonly status: number | undefined;
  readonly cause: unknown;

  constructor(
    reason: SurveyDetailErrorReason,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "SurveyDetailError";
    this.reason = reason;
    this.status = options.status;
    this.cause = options.cause;
  }
}
