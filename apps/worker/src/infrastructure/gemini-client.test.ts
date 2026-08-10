import type { GoogleGenAI, GoogleGenAIOptions } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import {
  createGeminiClient,
  detectPerson,
  generateAvatarImage,
  generateText,
} from "./gemini-client";

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

  it("人物の有無だけをstructured outputで判定すること", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"hasPerson":true}' });
    const client = { models: { generateContent } } as unknown as GoogleGenAI;

    await expect(
      detectPerson(client, {
        model: "gemini-person-model",
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/webp",
      }),
    ).resolves.toBe(true);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-person-model",
        config: expect.objectContaining({ responseMimeType: "application/json" }),
        contents: [
          expect.objectContaining({
            parts: expect.arrayContaining([
              { inlineData: { data: "AQID", mimeType: "image/webp" } },
            ]),
          }),
        ],
      }),
    );
  });

  it("画像生成モデルから返された画像だけを候補として復号すること", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: "ignored" }, { inlineData: { data: "BAUG", mimeType: "image/png" } }],
          },
        },
      ],
    });
    const client = { models: { generateContent } } as unknown as GoogleGenAI;

    await expect(
      generateAvatarImage(client, {
        model: "gemini-image-model",
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/webp",
        style: "test-style",
      }),
    ).resolves.toEqual({ bytes: new Uint8Array([4, 5, 6]), mimeType: "image/png" });
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-image-model",
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "1:1" },
        },
      }),
    );
  });
});
