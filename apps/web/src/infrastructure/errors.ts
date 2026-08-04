type ApplicationErrorOptions = {
  code: string;
  status?: number;
  cause?: unknown;
};

/** 機能固有の失敗をcodeで分類し、UIへ技術詳細を漏らさず渡す共通エラー。 */
class ApplicationError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly cause: unknown;

  constructor(message: string, options: ApplicationErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status;
    this.cause = options.cause;
  }
}

export class AuthenticationError extends ApplicationError {}

export class OperationError extends ApplicationError {}

export class ValidationError extends ApplicationError {}

export class UnknownError extends ApplicationError {}
