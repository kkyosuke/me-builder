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
      },
    },
  });
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
