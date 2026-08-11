import type { GoogleGenAI, GoogleGenAIOptions } from "@google/genai";
import { logger } from "@me-builder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiClient, generateText } from "./gemini-client";

describe("Gemini client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Vertex AI Express ModeへAPI keyで直接接続すること", () => {
    const client = {} as GoogleGenAI;
    const factory = vi.fn((_options: GoogleGenAIOptions) => client);

    const result = createGeminiClient({ googleVertexAiApiKey: "google-key" }, factory);

    expect(result).toBe(client);
    expect(factory).toHaveBeenCalledWith({
      vertexai: true,
      apiKey: "google-key",
      apiVersion: "v1",
    });
  });

  it("指定したモデルと本文で生成し、応答テキストを返すこと", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Cloudflare is ...",
      responseId: "response-1",
      modelVersion: "gemini-3.5-flash-lite-001",
      createTime: "2026-08-10T08:00:00.000Z",
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 4,
        thoughtsTokenCount: 2,
        cachedContentTokenCount: 3,
        toolUsePromptTokenCount: 1,
        totalTokenCount: 17,
      },
    });
    const client = { models: { generateContent } } as unknown as GoogleGenAI;
    const onUsage = vi.fn().mockResolvedValue(undefined);

    await expect(
      generateText(client, "gemini-3.5-flash-lite", "What is Cloudflare?", onUsage),
    ).resolves.toBe("Cloudflare is ...");
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-3.5-flash-lite",
      contents: "What is Cloudflare?",
    });
    expect(onUsage).toHaveBeenCalledWith({
      responseId: "response-1",
      model: "gemini-3.5-flash-lite-001",
      promptTokenCount: 10,
      candidatesTokenCount: 4,
      thoughtsTokenCount: 2,
      cachedContentTokenCount: 3,
      toolUsePromptTokenCount: 1,
      totalTokenCount: 17,
      generatedAt: new Date("2026-08-10T08:00:00.000Z"),
    });
  });

  it.each([
    [
      "responseId",
      {
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 4,
          totalTokenCount: 14,
        },
      },
    ],
    ["usageMetadata", { responseId: "response-1" }],
    [
      "candidatesTokenCount",
      {
        responseId: "response-1",
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 9 },
      },
    ],
  ])("%sが欠けても0として保存せず応答本文を返すこと", async (field, response) => {
    const generateContent = vi.fn().mockResolvedValue({ text: "generated", ...response });
    const client = { models: { generateContent } } as unknown as GoogleGenAI;
    const onUsage = vi.fn().mockResolvedValue(undefined);
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await expect(generateText(client, "gemini-test", "prompt", onUsage)).resolves.toBe("generated");

    expect(onUsage).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({
        resultCode: "GEMINI_USAGE_METADATA_INCOMPLETE",
        invalidFields: [field],
      }),
      "[Gemini usage] skipped at usage.validate -> continue",
    );
  });

  it("安全フィルター応答で省略された出力token数を導出して保存すること", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      responseId: "blocked-response-1",
      createTime: "2026-08-10T08:00:00.000Z",
      promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
    });
    const client = { models: { generateContent } } as unknown as GoogleGenAI;
    const onUsage = vi.fn().mockResolvedValue(undefined);
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await expect(generateText(client, "gemini-test", "prompt", onUsage)).resolves.toBeUndefined();

    expect(onUsage).toHaveBeenCalledWith({
      responseId: "blocked-response-1",
      model: "gemini-test",
      promptTokenCount: 10,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 0,
      toolUsePromptTokenCount: 0,
      totalTokenCount: 10,
      generatedAt: new Date("2026-08-10T08:00:00.000Z"),
    });
    expect(warning).not.toHaveBeenCalled();
  });
});
