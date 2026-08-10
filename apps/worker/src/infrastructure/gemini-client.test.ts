import type { GoogleGenAI, GoogleGenAIOptions } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { createGeminiClient, embedDocument, generateText } from "./gemini-client";

describe("Gemini client", () => {
  it("Cloudflare AI Gateway の URL と認証ヘッダーを SDK に設定すること", () => {
    const client = {} as GoogleGenAI;
    const factory = vi.fn((_options: GoogleGenAIOptions) => client);

    const result = createGeminiClient(
      {
        googleAiStudioApiKey: "google-key",
        cloudflareAiGatewayToken: "gateway-token",
        cloudflareAiGatewayBaseUrl: "https://gateway.example.com/google-ai-studio",
      },
      factory,
    );

    expect(result).toBe(client);
    expect(factory).toHaveBeenCalledWith({
      apiKey: "google-key",
      httpOptions: {
        baseUrl: "https://gateway.example.com/google-ai-studio",
        headers: {
          "cf-aig-authorization": "Bearer gateway-token",
          "cf-aig-collect-log-payload": "false",
          "cf-aig-cache-ttl": "0",
        },
      },
    });
  });

  it("指定したモデルと本文で生成し、応答テキストを返すこと", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "Cloudflare is ..." });
    const client = { models: { generateContent } } as unknown as GoogleGenAI;

    await expect(
      generateText(client, "gemini-3.5-flash-lite", "What is Cloudflare?"),
    ).resolves.toBe("Cloudflare is ...");
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-3.5-flash-lite",
      contents: "What is Cloudflare?",
    });
  });

  it("検索文書用taskで768次元embeddingを取得すること", async () => {
    const values = Array.from({ length: 768 }, () => 0.1);
    const embedContent = vi.fn().mockResolvedValue({ embeddings: [{ values }] });
    const client = { models: { embedContent } } as unknown as GoogleGenAI;

    await expect(
      embedDocument(client, {
        model: "gemini-embedding-001",
        contents: "公園を散歩した",
        dimensions: 768,
      }),
    ).resolves.toBe(values);
    expect(embedContent).toHaveBeenCalledWith({
      model: "gemini-embedding-001",
      contents: "公園を散歩した",
      config: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 768 },
    });
  });
});
