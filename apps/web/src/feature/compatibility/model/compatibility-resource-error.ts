/** 既存表示を維持せず、対象が利用できない状態へ切り替えるべき取得エラー。 */
export class CompatibilityResourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompatibilityResourceUnavailableError";
  }
}

export function isCompatibilityResourceUnavailableError(
  error: unknown,
): error is CompatibilityResourceUnavailableError {
  return error instanceof CompatibilityResourceUnavailableError;
}
