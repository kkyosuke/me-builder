import { describe, expect, it } from "vitest";
import {
  OperationalError,
  toOperationalError,
  toSafeOperationalErrorFields,
} from "./operational-error";

const fallback = {
  code: "UNEXPECTED_ERROR",
  category: "unknown",
  stage: "queue.dispatch",
  retryable: true,
} as const;

describe("OperationalError", () => {
  it("未知の例外を固定分類へ変換し、生の内容をログ用fieldへ出さない", () => {
    const error = new Error("日記本文とsecretを含む可能性がある内容");

    const fields = toSafeOperationalErrorFields(error, fallback);

    expect(fields).toEqual({
      errorCode: "UNEXPECTED_ERROR",
      errorCategory: "unknown",
      stage: "queue.dispatch",
      retryable: true,
    });
    expect(JSON.stringify(fields)).not.toContain(error.message);
    expect(JSON.stringify(fields)).not.toContain("stack");
  });

  it("下位境界で付けた分類を上位境界でも維持する", () => {
    const classified = new OperationalError(
      {
        code: "LINE_SOURCE_STORE_FAILED",
        category: "dependency",
        stage: "source.store",
        retryable: true,
        dependency: "account-data",
      },
      new Error("raw SDK response"),
    );

    expect(toOperationalError(classified, fallback)).toBe(classified);
    expect(toSafeOperationalErrorFields(classified, fallback)).toEqual({
      errorCode: "LINE_SOURCE_STORE_FAILED",
      errorCategory: "dependency",
      stage: "source.store",
      retryable: true,
      dependency: "account-data",
    });
  });
});
