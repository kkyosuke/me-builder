import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import { OperationalError, type OperationalErrorDescriptor } from "@me-builder/shared";
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

/**
 * `@google/genai`のApiErrorは、HTTP statusと、quota名やmodel名を含むresponse bodyを
 * messageへ持つ。messageをそのままログへ載せられないため、statusだけを残して
 * 固定のエラーコードと原因分類へ変換する。
 *
 * これにより、上位の終端ログだけで「Geminiの流量制限(429)」と
 * 「Geminiの一時障害(5xx)」と「資格情報の誤り(401/403)」を区別できる。
 */
export function toGeminiOperationalError(error: unknown, stage: string): OperationalError {
  if (error instanceof OperationalError) return error;

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : Number.NaN;
  const aborted = error instanceof Error && error.name === "AbortError";

  // retryableは現在の挙動を変えないため一律trueにする。
  // statusに応じて再試行を打ち切るかは、挙動の変更として別に判断する。
  const descriptor: OperationalErrorDescriptor = {
    ...classifyGeminiFailure(status, aborted),
    stage,
    retryable: true,
    dependency: "google-ai",
    ...(Number.isFinite(status) ? { dependencyStatus: status } : {}),
  };
  return new OperationalError(descriptor, error);
}

function classifyGeminiFailure(
  status: number,
  aborted: boolean,
): Pick<OperationalErrorDescriptor, "code" | "category"> {
  if (aborted) return { code: "GEMINI_CALL_ABORTED", category: "timeout" };
  if (status === 429) return { code: "GEMINI_RATE_LIMITED", category: "dependency" };
  if (status === 401 || status === 403) {
    return { code: "GEMINI_CREDENTIALS_REJECTED", category: "configuration" };
  }
  if (status === 404) return { code: "GEMINI_MODEL_NOT_FOUND", category: "configuration" };
  if (status === 400) return { code: "GEMINI_REQUEST_REJECTED", category: "validation" };
  if (status >= 500) return { code: "GEMINI_UNAVAILABLE", category: "dependency" };
  return { code: "GEMINI_CALL_FAILED", category: "dependency" };
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
  try {
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
  } catch (error) {
    throw toGeminiOperationalError(error, "ai.generate");
  }
}

/** 指定した Gemini モデルへテキスト生成を依頼し、応答本文を返します。 */
export async function generateText(
  client: GoogleGenAI,
  model: string,
  contents: string,
): Promise<string | undefined> {
  try {
    const response = await client.models.generateContent({ model, contents });
    return response.text;
  } catch (error) {
    throw toGeminiOperationalError(error, "ai.generate");
  }
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
  try {
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
  } catch (error) {
    throw toGeminiOperationalError(error, "avatar.person-detect");
  }
}

/** 参照画像を本人らしさを保った正方形アバターへ変換する。 */
export async function generateAvatarImage(
  client: GoogleGenAI,
  input: { model: string; bytes: Uint8Array; mimeType: string; style: string },
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  try {
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
  } catch (error) {
    throw toGeminiOperationalError(error, "avatar.generate");
  }
}
