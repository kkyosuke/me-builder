import * as v from "valibot";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
export const BRAIN_VECTOR_DIMENSIONS = 768;
export const DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT = 20;

export const WorkerConfigSchema = v.object({
  environment: v.optional(v.string(), "development"),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  apiUrl: v.optional(v.string()),
  lineChannelAccessToken: v.optional(v.string()),
  /** LIFF ID。設定時のみ、返信に LIFF のリンクを添えます。 */
  liffId: v.optional(v.string()),
  googleVertexAiApiKey: v.optional(v.string()),
  geminiModel: v.optional(v.string(), DEFAULT_GEMINI_MODEL),
  geminiEmbeddingModel: v.optional(v.string(), DEFAULT_GEMINI_EMBEDDING_MODEL),
  brainVectorHmacSecret: v.optional(v.string()),
  chatDeliverySecret: v.optional(v.string()),
  chatContextMessageLimit: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1)),
    DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  ),
  adminLineUserIds: v.optional(v.array(v.string()), []),
  stripeSecretKey: v.optional(v.string()),
  billingPricePlanMap: v.optional(v.record(v.string(), v.picklist(["lite", "full", "family"])), {}),
  avatarCleanupMode: v.optional(v.picklist(["dry-run", "delete"]), "dry-run"),
});

export type WorkerConfig = v.InferOutput<typeof WorkerConfigSchema>;
