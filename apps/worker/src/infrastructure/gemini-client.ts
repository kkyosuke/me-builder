import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";

export interface GeminiGatewayConfig {
  googleAiStudioApiKey: string;
  cloudflareAiGatewayToken: string;
  cloudflareAiGatewayBaseUrl: string;
}

type GoogleGenAiFactory = (options: GoogleGenAIOptions) => GoogleGenAI;

/** Cloudflare AI Gateway 経由で Google AI Studio を呼び出すクライアントを作成します。 */
export function createGeminiClient(
  config: GeminiGatewayConfig,
  factory: GoogleGenAiFactory = (options) => new GoogleGenAI(options),
): GoogleGenAI {
  return factory({
    apiKey: config.googleAiStudioApiKey,
    httpOptions: {
      baseUrl: config.cloudflareAiGatewayBaseUrl,
      headers: {
        "cf-aig-authorization": `Bearer ${config.cloudflareAiGatewayToken}`,
        // 日記本文・AI応答本文をGatewayへ保存せず、token数やcostなどのmetadataだけを残す。
        "cf-aig-collect-log-payload": "false",
        "cf-aig-cache-ttl": "0",
      },
    },
  });
}

export async function generateStructuredText(
  client: GoogleGenAI,
  input: {
    model: string;
    contents: string;
    systemInstruction: string;
    responseJsonSchema: Record<string, unknown>;
    maxOutputTokens: number;
    signal?: AbortSignal;
  },
): Promise<string | undefined> {
  const response = await client.models.generateContent({
    model: input.model,
    contents: input.contents,
    config: {
      systemInstruction: input.systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema: input.responseJsonSchema,
      maxOutputTokens: input.maxOutputTokens,
      ...(input.signal ? { abortSignal: input.signal } : {}),
    },
  });
  return response.text;
}

/** 指定した Gemini モデルへテキスト生成を依頼し、応答本文を返します。 */
export async function generateText(
  client: GoogleGenAI,
  model: string,
  contents: string,
): Promise<string | undefined> {
  const response = await client.models.generateContent({ model, contents });
  return response.text;
}
