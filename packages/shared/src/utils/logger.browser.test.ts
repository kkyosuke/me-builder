import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

type BrowserLoggerOptions = Readonly<{
  level: string;
  browser: {
    write?: (value: unknown) => void;
    formatters?: {
      level?: (label: string, number: number) => Record<string, unknown>;
      log?: (object: Record<string, unknown>) => Record<string, unknown>;
    };
  };
}>;

const pinoBrowser = vi.hoisted(() =>
  vi.fn((options: BrowserLoggerOptions) => {
    const write = options.browser.write ?? (() => undefined);
    const log = (
      label: string,
      number: number,
      fields: Record<string, unknown>,
      message: string,
    ) => {
      const level = options.browser.formatters?.level?.(label, number) ?? { level: number };
      const object = { ...level, ...fields, msg: message };
      write(options.browser.formatters?.log?.(object) ?? object);
    };
    return {
      level: options.level,
      child() {
        return this;
      },
      info(fields: Record<string, unknown>, message: string) {
        log("info", 30, fields, message);
      },
      error(fields: Record<string, unknown>, message: string) {
        log("error", 50, fields, message);
      },
    };
  }),
);

vi.mock("pino", () => ({ default: pinoBrowser }));

describe("browser logger", () => {
  it("Pino browserの出力経路から本人識別子を除去する", () => {
    const output: unknown[] = [];
    const browserLogger = createLogger({
      browser: {
        write(value) {
          output.push(value);
        },
        formatters: {
          log(object) {
            return { ...object, formatted: true, userId: "U-formatter-secret" };
          },
        },
      },
    });

    browserLogger.info(
      {
        event: "browser.logger.output.test",
        accountId: "account-secret",
        err: new Error("providerAccountId=U-error-secret"),
      },
      "safe message",
    );

    expect(output).toHaveLength(1);
    const serialized = JSON.stringify(output);
    expect(serialized).toContain('"event":"browser.logger.output.test"');
    expect(serialized).toContain('"level":"info"');
    expect(serialized).not.toContain('"level":30');
    expect(serialized).toContain('"formatted":true');
    expect(serialized).toContain('"err":"[Object omitted]"');
    expect(serialized).not.toContain("account-secret");
    expect(serialized).not.toContain("U-formatter-secret");
    expect(serialized).not.toContain("U-error-secret");
    expect(pinoBrowser).toHaveBeenCalled();
  });

  it("カスタムformatterがあってもerrorの文字列levelを保つ", () => {
    const output: unknown[] = [];
    const browserLogger = createLogger({
      browser: {
        write(value) {
          output.push(value);
        },
        formatters: {
          level(_label, number) {
            return { level: number, customLevel: true };
          },
        },
      },
    });

    browserLogger.error({ event: "browser.logger.error.test" }, "failed");

    expect(output).toEqual([
      expect.objectContaining({
        level: "error",
        customLevel: true,
        event: "browser.logger.error.test",
      }),
    ]);
  });
});
