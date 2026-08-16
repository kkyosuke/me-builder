import { describe, expect, it } from "vitest";
import { createLogger, logger, omitForbiddenLogFields } from "./logger";

describe("logger", () => {
  it("default logger should be defined and have logging methods", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.warn).toBe("function");
  });

  it("createLogger should create custom logger instance", () => {
    const customLogger = createLogger({ name: "custom-app", level: "debug" });
    expect(customLogger).toBeDefined();
    expect(customLogger.level).toBe("debug");
  });

  it("Account IDと外部user IDを入れ子を含めてログ項目から除去する", () => {
    expect(
      omitForbiddenLogFields({
        event: "admin.billing.reconciled",
        accountId: "account-1",
        adminAccountId: "admin-1",
        nested: {
          provider_account_id: "U-provider",
          userId: "U-user",
          outcome: "succeeded",
        },
        attempts: [{ targetAccountId: "target-1", attempt: 1 }],
      }),
    ).toEqual({
      event: "admin.billing.reconciled",
      nested: { outcome: "succeeded" },
      attempts: [{ attempt: 1 }],
    });
  });

  it("生の例外と任意objectを出力可能な値へ置き換える", () => {
    const error = Object.assign(new Error("providerAccountId=U-secret"), {
      accountId: "account-secret",
    });

    expect(
      omitForbiddenLogFields({
        event: "account.identity.failed",
        err: error,
        request: new URL("https://example.com/?token=secret"),
      }),
    ).toEqual({
      event: "account.identity.failed",
      err: "[Object omitted]",
      request: "[Object omitted]",
    });
  });

  it("循環参照を含む構造でもログ出力を失敗させない", () => {
    const fields: Record<string, unknown> = { event: "cyclic.test", accountId: "secret" };
    fields.self = fields;

    const sanitized = omitForbiddenLogFields(fields) as Record<string, unknown>;

    expect(sanitized.accountId).toBeUndefined();
    expect(sanitized.self).toBe(sanitized);
  });

  it("Nodeの実ログ出力から本人識別子と生の例外を除去する", () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const outputLogger = createLogger({
        base: { accountId: "base-secret", service: "shared-test" },
        timestamp: false,
      });
      outputLogger.info(
        {
          event: "logger.output.test",
          accountId: "account-secret",
          err: new Error("providerAccountId=U-secret"),
        },
        "safe message",
      );
      outputLogger
        .child({ component: "child-test", userId: "child-secret" })
        .info({ outcome: "succeeded" }, "child message");
      outputLogger.flush();
    } finally {
      process.stdout.write = originalWrite;
    }

    const serialized = writes.join("");
    expect(serialized).toContain('"event":"logger.output.test"');
    expect(serialized).toContain('"service":"shared-test"');
    expect(serialized).toContain('"component":"child-test"');
    expect(serialized).toContain('"err":"[Object omitted]"');
    expect(serialized).not.toContain("account-secret");
    expect(serialized).not.toContain("base-secret");
    expect(serialized).not.toContain("child-secret");
    expect(serialized).not.toContain("U-secret");
    expect(serialized).not.toContain('"stack"');
  });
});
