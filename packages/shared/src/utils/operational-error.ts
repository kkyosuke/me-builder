export type OperationalErrorCategory =
  | "configuration"
  | "validation"
  | "invariant"
  | "dependency"
  | "timeout"
  | "concurrency"
  | "unknown";

export type OperationalErrorDescriptor = {
  code: string;
  category: OperationalErrorCategory;
  stage: string;
  retryable: boolean;
  dependency?: string;
};

/**
 * 運用ログへ安全に出せる固定情報だけを持つエラー。
 * causeは制御フローのために保持するが、ログへserializeしない。
 */
export class OperationalError extends Error {
  readonly code: string;
  readonly category: OperationalErrorCategory;
  readonly stage: string;
  readonly retryable: boolean;
  readonly dependency: string | undefined;

  constructor(descriptor: OperationalErrorDescriptor, cause?: unknown) {
    super(descriptor.code);
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: cause,
        writable: true,
      });
    }
    this.name = "OperationalError";
    this.code = descriptor.code;
    this.category = descriptor.category;
    this.stage = descriptor.stage;
    this.retryable = descriptor.retryable;
    this.dependency = descriptor.dependency;
  }
}

export type SafeOperationalErrorFields = {
  errorCode: string;
  errorCategory: OperationalErrorCategory;
  stage: string;
  retryable: boolean;
  dependency?: string;
};

export function toOperationalError(
  error: unknown,
  fallback: OperationalErrorDescriptor,
): OperationalError {
  return error instanceof OperationalError ? error : new OperationalError(fallback, error);
}

/** 生のmessage、stack、causeを含めないログ用allowlist。 */
export function toSafeOperationalErrorFields(
  error: unknown,
  fallback: OperationalErrorDescriptor,
): SafeOperationalErrorFields {
  const operationalError = toOperationalError(error, fallback);
  return {
    errorCode: operationalError.code,
    errorCategory: operationalError.category,
    stage: operationalError.stage,
    retryable: operationalError.retryable,
    ...(operationalError.dependency ? { dependency: operationalError.dependency } : {}),
  };
}
