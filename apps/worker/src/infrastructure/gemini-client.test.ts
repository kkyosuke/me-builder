import type { GoogleGenAI, GoogleGenAIOptions } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { createGeminiClient, generateText } from "./gemini-client";

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
});
