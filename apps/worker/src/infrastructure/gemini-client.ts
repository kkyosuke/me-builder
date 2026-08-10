import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import * as v from "valibot";

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

const PersonDetectionSchema = v.object({ hasPerson: v.boolean() });

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** 画像に人物が写っているかだけをstructured outputで判定する。 */
export async function detectPerson(
  client: GoogleGenAI,
  input: { model: string; bytes: Uint8Array; mimeType: string },
): Promise<boolean> {
  const response = await client.models.generateContent({
    model: input.model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: base64(input.bytes), mimeType: input.mimeType } },
          {
            text: "この画像に実在または描画された人物が1人以上写っているかだけを判定してください。人物の本人性、属性、感情、健康状態は推定しないでください。",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: { hasPerson: { type: "boolean" } },
        required: ["hasPerson"],
        additionalProperties: false,
      },
      maxOutputTokens: 32,
    },
  });
  return v.parse(PersonDetectionSchema, JSON.parse(response.text ?? "")).hasPerson;
}

/** 参照画像を本人らしさを保った正方形アバターへ変換する。 */
export async function generateAvatarImage(
  client: GoogleGenAI,
  input: { model: string; bytes: Uint8Array; mimeType: string; style: string },
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await client.models.generateContent({
    model: input.model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: base64(input.bytes), mimeType: input.mimeType } },
          {
            text: `添付画像の人物を、本人らしさを保ちながら安全なプロフィールアバターへ変換してください。正方形、顔と上半身が中央、文字・ロゴなし、背景は簡潔。画風: ${input.style}`,
          },
        ],
      },
    ],
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "1:1" },
    },
  });
  const part = response.candidates?.[0]?.content?.parts?.find(
    (candidate) =>
      candidate.inlineData?.data && candidate.inlineData.mimeType?.startsWith("image/"),
  );
  if (!part?.inlineData?.data || !part.inlineData.mimeType) {
    throw new Error("Gemini did not return an avatar image");
  }
  return {
    bytes: new Uint8Array(Buffer.from(part.inlineData.data, "base64")),
    mimeType: part.inlineData.mimeType,
  };
}
