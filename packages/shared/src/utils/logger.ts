import pino, {
  type Bindings,
  type ChildLoggerOptions,
  type Logger,
  type LoggerOptions,
} from "pino";

export type { Logger, LoggerOptions };

export interface CreateLoggerOptions extends LoggerOptions {
  name?: string;
  level?: string;
}

const forbiddenIdentityKey = /(?:account|user)id$/i;
const omittedObject = "[Object omitted]";

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function omitForbiddenLogFieldsWithSeen(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }

  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const fieldValue of value) output.push(omitForbiddenLogFieldsWithSeen(fieldValue, seen));
    return output;
  }

  // ErrorやSDK objectを無加工で渡すとmessage、stack、独自fieldへ機微情報が混入しうる。
  if (!isRecord(value)) return omittedObject;

  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, fieldValue] of Object.entries(value)) {
    if (forbiddenIdentityKey.test(key.replace(/[_-]/g, ""))) continue;
    output[key] = omitForbiddenLogFieldsWithSeen(fieldValue, seen);
  }
  return output;
}

/** 運用ログへ本人識別子や任意objectを渡しても、安全な構造へ変換してから出力する。 */
export function omitForbiddenLogFields(value: unknown): unknown {
  return omitForbiddenLogFieldsWithSeen(value, new WeakMap());
}

function protectChildBindings(logger: Logger): Logger {
  const createChild = logger.child.bind(logger);
  logger.child = ((bindings: Bindings, childOptions?: ChildLoggerOptions) =>
    protectChildBindings(
      createChild(omitForbiddenLogFields(bindings) as Bindings, childOptions),
    )) as unknown as Logger["child"];
  return logger;
}

/**
 * 構造化 JSON ログを出力する Pino ロガーインスタンスを生成します。
 */
export function createLogger(options?: CreateLoggerOptions): Logger {
  const defaultLevel =
    typeof process !== "undefined" && process.env?.LOG_LEVEL ? process.env.LOG_LEVEL : "info";

  const { browser: browserOptions, formatters: formatterOptions, ...loggerOptions } = options ?? {};
  const configuredLogFormatter = formatterOptions?.log;
  const configuredLevelFormatter = formatterOptions?.level;
  const configuredBindingsFormatter = formatterOptions?.bindings;
  const configuredBrowserLogFormatter = browserOptions?.formatters?.log;
  const configuredBrowserLevelFormatter = browserOptions?.formatters?.level;

  return protectChildBindings(
    pino({
      name: options?.name ?? "me-builder",
      level: options?.level ?? defaultLevel,
      ...loggerOptions,
      browser: {
        disabled: false,
        asObject: false,
        ...browserOptions,
        formatters: {
          ...browserOptions?.formatters,
          level(label, number) {
            return {
              ...(configuredBrowserLevelFormatter
                ? configuredBrowserLevelFormatter(label, number)
                : {}),
              level: label,
            };
          },
          log(object) {
            return omitForbiddenLogFields(
              configuredBrowserLogFormatter ? configuredBrowserLogFormatter(object) : object,
            ) as Record<string, unknown>;
          },
        },
      },
      formatters: {
        ...formatterOptions,
        level(label, number) {
          return {
            ...(configuredLevelFormatter ? configuredLevelFormatter(label, number) : {}),
            level: label,
          };
        },
        bindings(bindings) {
          return omitForbiddenLogFields(
            configuredBindingsFormatter ? configuredBindingsFormatter(bindings) : bindings,
          ) as Record<string, unknown>;
        },
        log(object) {
          return omitForbiddenLogFields(
            configuredLogFormatter ? configuredLogFormatter(object) : object,
          ) as Record<string, unknown>;
        },
      },
    }),
  );
}

/**
 * デフォルトの共有構造化 JSON ロガーインスタンス
 */
export const logger: Logger = createLogger();
