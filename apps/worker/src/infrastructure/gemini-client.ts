import { type GenerateContentResponse, GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import { OperationalError, type OperationalErrorDescriptor, logger } from "@me-builder/shared";

export interface GeminiConfig {
  googleVertexAiApiKey: string;
}

interface GeminiUsage {
  responseId: string;
  model: string;
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  cachedContentTokenCount: number;
  toolUsePromptTokenCount: number;
  totalTokenCount: number;
  generatedAt: Date;
}

export type GeminiUsageRecorder = (usage: GeminiUsage) => Promise<void>;

type GoogleGenAiFactory = (options: GoogleGenAIOptions) => GoogleGenAI;

/** Vertex AI Express ModeへAPI keyで直接接続するクライアントを作成します。 */
export function createGeminiClient(
  config: GeminiConfig,
  factory: GoogleGenAiFactory = (options) => new GoogleGenAI(options),
): GoogleGenAI {
  return factory({
    vertexai: true,
    apiKey: config.googleVertexAiApiKey,
    apiVersion: "v1",
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

function isTokenCount(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0;
}

function toGeminiUsage(
  response: GenerateContentResponse,
  requestedModel: string,
): GeminiUsage | undefined {
  const responseId = response.responseId?.trim();
  const metadata = response.usageMetadata;
  const promptTokenCount = isTokenCount(metadata?.promptTokenCount)
    ? metadata.promptTokenCount
    : undefined;
  const totalTokenCount = isTokenCount(metadata?.totalTokenCount)
    ? metadata.totalTokenCount
    : undefined;
  const thoughtsTokenCount = isTokenCount(metadata?.thoughtsTokenCount)
    ? metadata.thoughtsTokenCount
    : 0;
  const toolUsePromptTokenCount = isTokenCount(metadata?.toolUsePromptTokenCount)
    ? metadata.toolUsePromptTokenCount
    : 0;
  const derivedCandidatesTokenCount =
    metadata?.candidatesTokenCount === undefined &&
    promptTokenCount !== undefined &&
    totalTokenCount !== undefined
      ? totalTokenCount - promptTokenCount - thoughtsTokenCount - toolUsePromptTokenCount
      : undefined;
  const candidatesTokenCount = isTokenCount(metadata?.candidatesTokenCount)
    ? metadata.candidatesTokenCount
    : isTokenCount(derivedCandidatesTokenCount)
      ? derivedCandidatesTokenCount
      : undefined;
  const missingFields = [
    ...(!responseId ? ["responseId"] : []),
    ...(!metadata ? ["usageMetadata"] : []),
    ...(metadata && promptTokenCount === undefined ? ["promptTokenCount"] : []),
    ...(metadata && candidatesTokenCount === undefined ? ["candidatesTokenCount"] : []),
    ...(metadata && totalTokenCount === undefined ? ["totalTokenCount"] : []),
  ];
  const optionalTokenCounts: Array<[string, number | undefined]> = metadata
    ? [
        ["thoughtsTokenCount", metadata.thoughtsTokenCount],
        ["cachedContentTokenCount", metadata.cachedContentTokenCount],
        ["toolUsePromptTokenCount", metadata.toolUsePromptTokenCount],
      ]
    : [];
  const invalidOptionalFields = optionalTokenCounts
    .filter(([, value]) => value !== undefined && !isTokenCount(value))
    .map(([name]) => name);
  const invalidFields = [...missingFields, ...invalidOptionalFields];
  if (
    invalidFields.length > 0 ||
    !responseId ||
    !metadata ||
    promptTokenCount === undefined ||
    candidatesTokenCount === undefined ||
    totalTokenCount === undefined
  ) {
    logger.warn(
      {
        event: "gemini.usage.skipped",
        service: "worker",
        component: "gemini-client",
        outcome: "discarded",
        disposition: "continue",
        stage: "usage.validate",
        resultCode: "GEMINI_USAGE_METADATA_INCOMPLETE",
        invalidFields,
      },
      "[Gemini usage] skipped at usage.validate -> continue",
    );
    return undefined;
  }
  const generatedAt = response.createTime ? new Date(response.createTime) : new Date();
  return {
    responseId,
    model: response.modelVersion ?? requestedModel,
    promptTokenCount,
    candidatesTokenCount,
    thoughtsTokenCount,
    cachedContentTokenCount: metadata.cachedContentTokenCount ?? 0,
    toolUsePromptTokenCount,
    totalTokenCount,
    generatedAt: Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt,
  };
}

async function recordGeminiUsage(
  response: GenerateContentResponse,
  requestedModel: string,
  recorder: GeminiUsageRecorder | undefined,
): Promise<void> {
  if (!recorder) return;
  const usage = toGeminiUsage(response, requestedModel);
  if (usage) await recorder(usage);
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
    onUsage?: GeminiUsageRecorder;
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
    await recordGeminiUsage(response, input.model, input.onUsage);
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
  onUsage?: GeminiUsageRecorder,
): Promise<string | undefined> {
  try {
    const response = await client.models.generateContent({ model, contents });
    await recordGeminiUsage(response, model, onUsage);
    return response.text;
  } catch (error) {
    throw toGeminiOperationalError(error, "ai.generate");
  }
}
