import * as v from "valibot";

export const DEFAULT_CLOUDFLARE_AI_GATEWAY_BASE_URL =
  "https://gateway.ai.cloudflare.com/v1/8e0b10ee5263d2f699a93dbe3ee97da0/default/google-ai-studio";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
export const DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT = 20;
export const DEFAULT_AVATAR_GENERATION_RATE_LIMIT = 3;

export const WorkerConfigSchema = v.object({
  environment: v.optional(v.string(), "development"),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  apiUrl: v.optional(v.string()),
  lineChannelAccessToken: v.optional(v.string()),
  /** LIFF ID。設定時のみ、返信に LIFF のリンクを添えます。 */
  liffId: v.optional(v.string()),
  googleAiStudioApiKey: v.optional(v.string()),
  cloudflareAiGatewayToken: v.optional(v.string()),
  cloudflareAiGatewayBaseUrl: v.optional(
    v.pipe(v.string(), v.url()),
    DEFAULT_CLOUDFLARE_AI_GATEWAY_BASE_URL,
  ),
  geminiModel: v.optional(v.string(), DEFAULT_GEMINI_MODEL),
  geminiImageModel: v.optional(v.string(), DEFAULT_GEMINI_IMAGE_MODEL),
  avatarGenerationRateLimit: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0)),
    DEFAULT_AVATAR_GENERATION_RATE_LIMIT,
  ),
  chatEnabled: v.optional(v.boolean(), true),
  chatDeliverySecret: v.optional(v.string()),
  chatContextMessageLimit: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1)),
    DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  ),
  adminLineUserIds: v.optional(v.array(v.string()), []),
});

export type WorkerConfig = v.InferOutput<typeof WorkerConfigSchema>;
