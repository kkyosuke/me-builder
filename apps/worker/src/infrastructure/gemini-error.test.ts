import { ApiError, type GoogleGenAI } from "@google/genai";
import {
  OperationalError,
  describeQueueMessageResult,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import { detectPerson, generateAvatarImage, toGeminiOperationalError } from "./gemini-client";

/** 実際に観測された429のresponse body。quota名とmodel名を含むためログへ出せない。 */
const QUOTA_BODY = JSON.stringify({
  error: {
    code: 429,
    message:
      "You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: gemini-2.5-flash-preview-image",
  },
});

describe("toGeminiOperationalError", () => {
  it("429を流量制限として分類し、statusを残す", () => {
    const error = toGeminiOperationalError(
      new ApiError({ message: QUOTA_BODY, status: 429 }),
      "ai.generate",
    );

    expect(error).toBeInstanceOf(OperationalError);
    expect(error.code).toBe("GEMINI_RATE_LIMITED");
    expect(error.category).toBe("dependency");
    expect(error.dependency).toBe("google-ai");
    expect(error.dependencyStatus).toBe(429);
  });

  it.each([
    [
      "人物判定",
      (client: GoogleGenAI) =>
        detectPerson(client, {
          model: "person-model",
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: "image/webp",
        }),
      "avatar.person-detect",
    ],
    [
      "アバター生成",
      (client: GoogleGenAI) =>
        generateAvatarImage(client, {
          model: "image-model",
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: "image/webp",
          style: "test-style",
        }),
      "avatar.generate",
    ],
  ])("%sのSDK例外を安全なエラーへ変換する", async (_name, call, stage) => {
    const client = {
      models: {
        generateContent: vi
          .fn()
          .mockRejectedValue(new ApiError({ message: QUOTA_BODY, status: 429 })),
      },
    } as unknown as GoogleGenAI;

    const error = await call(client).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(OperationalError);
    expect(error).toMatchObject({
      code: "GEMINI_RATE_LIMITED",
      category: "dependency",
      stage,
      dependency: "google-ai",
      dependencyStatus: 429,
    });
    expect(
      JSON.stringify(
        toSafeOperationalErrorFields(error, {
          code: "UNEXPECTED",
          category: "unknown",
          stage,
          retryable: true,
        }),
      ),
    ).not.toContain("free_tier");
  });

  it("statusごとに原因分類を分ける", () => {
    const classify = (status: number) =>
      toGeminiOperationalError(new ApiError({ message: "x", status }), "ai.generate");

    expect(classify(401).code).toBe("GEMINI_CREDENTIALS_REJECTED");
    expect(classify(401).category).toBe("configuration");
    expect(classify(403).code).toBe("GEMINI_CREDENTIALS_REJECTED");
    expect(classify(404).code).toBe("GEMINI_MODEL_NOT_FOUND");
    expect(classify(400).code).toBe("GEMINI_REQUEST_REJECTED");
    expect(classify(400).category).toBe("validation");
    expect(classify(503).code).toBe("GEMINI_UNAVAILABLE");
    expect(classify(503).category).toBe("dependency");
  });

  it("中断はタイムアウトとして扱い、statusを持たない", () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";

    const error = toGeminiOperationalError(aborted, "ai.generate");

    expect(error.code).toBe("GEMINI_CALL_ABORTED");
    expect(error.category).toBe("timeout");
    expect(error.dependencyStatus).toBeUndefined();
  });

  it("statusを持たない未知の例外も工程と依存先までは分かるようにする", () => {
    const error = toGeminiOperationalError(new Error("socket hang up"), "ai.generate");

    expect(error.code).toBe("GEMINI_CALL_FAILED");
    expect(error.stage).toBe("ai.generate");
    expect(error.dependency).toBe("google-ai");
    expect(error.dependencyStatus).toBeUndefined();
  });

  it("既に分類済みのエラーは上書きしない", () => {
    const original = new OperationalError({
      code: "DIARY_CHAT_GENERATION_FAILED",
      category: "dependency",
      stage: "ai.generate",
      retryable: true,
    });

    expect(toGeminiOperationalError(original, "other.stage")).toBe(original);
  });

  it("quota bodyをログ用フィールドとmessageへ出さない", () => {
    const error = toGeminiOperationalError(
      new ApiError({ message: QUOTA_BODY, status: 429 }),
      "ai.generate",
    );
    const safeError = toSafeOperationalErrorFields(error, {
      code: "UNEXPECTED",
      category: "unknown",
      stage: "ai.generate",
      retryable: true,
    });
    const description = describeQueueMessageResult({
      flow: "chat-turn",
      outcome: "failed",
      disposition: "retry",
      stage: safeError.stage,
      attempt: 2,
      maxAttempts: 6,
      durationMs: 812,
      error: safeError,
    });

    expect(description).toBe(
      "[Chat turn] failed at ai.generate -> retry (attempt 2/6, 812ms, GEMINI_RATE_LIMITED, category:dependency, via:google-ai 429)",
    );
    for (const output of [JSON.stringify(safeError), description]) {
      expect(output).not.toContain("billing");
      expect(output).not.toContain("free_tier");
      expect(output).not.toContain("gemini-2.5-flash-preview-image");
    }
  });
});
