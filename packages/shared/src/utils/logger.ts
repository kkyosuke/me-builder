import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger, LoggerOptions };

export interface CreateLoggerOptions extends LoggerOptions {
  name?: string;
  level?: string;
}

/**
 * 構造化 JSON ログを出力する Pino ロガーインスタンスを生成します。
 */
export function createLogger(options?: CreateLoggerOptions): Logger {
  const defaultLevel =
    typeof process !== "undefined" && process.env?.LOG_LEVEL ? process.env.LOG_LEVEL : "info";

  return pino({
    name: options?.name ?? "me-builder",
    level: options?.level ?? defaultLevel,
    browser: {
      disabled: false,
      asObject: false,
    },
    ...options,
  });
}

/**
 * デフォルトの共有構造化 JSON ロガーインスタンス
 */
export const logger: Logger = createLogger();
