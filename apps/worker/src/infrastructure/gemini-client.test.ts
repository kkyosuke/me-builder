import type { GoogleGenAI, GoogleGenAIOptions } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { createGeminiClient, generateText } from "./gemini-client";

describe("Gemini client", () => {
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
