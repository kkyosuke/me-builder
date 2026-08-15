import { resolveLiffConfiguration } from "@me-builder/lib/line/liff-configuration";
import { getEnv, logger, parseAdminLineUserIds } from "@me-builder/shared";
import * as v from "valibot";
import {
  DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_GEMINI_MODEL,
  type WorkerConfig,
  WorkerConfigSchema,
} from "./schema";

export { DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT, DEFAULT_GEMINI_MODEL, WorkerConfigSchema };
export type { WorkerConfig };
export { type CloudflareBindings, getCloudflareBindings } from "./cloudflare";

/**
 * 設定値の書き間違いでWorker全体が起動不能にならないよう、不正値は既定値へ落とす。
 * ここでNaNを通すとschema検証で例外になり、日記以外のqueue処理まで巻き込んで止まる。
 */
function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn({ fallback }, "Ignored an invalid CHAT_CONTEXT_MESSAGE_LIMIT and used the default");
    return fallback;
  }
  return parsed;
}

function parseBillingPricePlanMap(
  raw: string | undefined,
): Record<string, "lite" | "full" | "family"> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, "lite" | "full" | "family"] =>
          entry[0].length > 0 && ["lite", "full", "family"].includes(String(entry[1])),
      ),
    );
  } catch {
    logger.warn("Ignored an invalid BILLING_PRICE_PLAN_MAP");
    return {};
  }
}

/**
 * Worker アプリケーションの環境設定を取得・パースして返却します。
 * Cloudflare Workers の c.env や process.env の差分を @me-builder/shared の getEnv で吸収します。
 */
export function getWorkerConfig(env?: Record<string, unknown>): WorkerConfig {
  const rawEnvironment = getEnv(["ENVIRONMENT", "NODE_ENV"], env);
  const rawBaseDomain = getEnv("BASE_DOMAIN", env);
  let rawBaseUrl = getEnv("BASE_URL", env);
  let rawApiUrl = getEnv("API_URL", env);

  if ((!rawBaseUrl || rawBaseUrl === "/") && rawBaseDomain) {
    const domain = rawBaseDomain.startsWith("http")
      ? rawBaseDomain
      : rawBaseDomain.startsWith("worker.")
        ? `https://${rawBaseDomain}`
        : `https://worker.${rawBaseDomain}`;
    rawBaseUrl = domain;
  }

  if ((!rawApiUrl || rawApiUrl === "/") && rawBaseDomain) {
    const domain = rawBaseDomain.startsWith("http")
      ? rawBaseDomain
      : rawBaseDomain.startsWith("api.")
        ? `https://${rawBaseDomain}`
        : `https://api.${rawBaseDomain}`;
    rawApiUrl = domain;
  }

  const rawLineChannelAccessToken = getEnv("LINE_CHANNEL_ACCESS_TOKEN", env);
  const liffConfiguration = resolveLiffConfiguration({ liffId: getEnv("LIFF_ID", env) });
  const rawGoogleVertexAiApiKey = getEnv("GOOGLE_VERTEX_AI_API_KEY", env)?.trim() || undefined;
  const rawGeminiModel = getEnv("GEMINI_MODEL", env)?.trim() || DEFAULT_GEMINI_MODEL;
  const rawGeminiEmbeddingModel =
    getEnv("GEMINI_EMBEDDING_MODEL", env)?.trim() || DEFAULT_GEMINI_EMBEDDING_MODEL;
  const rawBrainVectorHmacSecret = getEnv("BRAIN_VECTOR_HMAC_SECRET", env)?.trim() || undefined;
  const rawChatDeliverySecret = getEnv("CHAT_DELIVERY_SECRET", env)?.trim() || undefined;
  const rawChatContextMessageLimit = getEnv("CHAT_CONTEXT_MESSAGE_LIMIT", env)?.trim();
  const adminLineUserIds = parseAdminLineUserIds(getEnv("ADMIN_LINE_USER_IDS", env));

  const rawConfig = {
    environment: rawEnvironment,
    baseDomain: rawBaseDomain,
    baseUrl: rawBaseUrl,
    apiUrl: rawApiUrl,
    lineChannelAccessToken: rawLineChannelAccessToken,
    liffId: liffConfiguration.liffId,
    googleVertexAiApiKey: rawGoogleVertexAiApiKey,
    geminiModel: rawGeminiModel,
    geminiEmbeddingModel: rawGeminiEmbeddingModel,
    brainVectorHmacSecret: rawBrainVectorHmacSecret,
    chatDeliverySecret: rawChatDeliverySecret,
    chatContextMessageLimit: parsePositiveInteger(
      rawChatContextMessageLimit,
      DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
    ),
    adminLineUserIds,
    stripeSecretKey: getEnv("STRIPE_SECRET_KEY", env)?.trim() || undefined,
    billingPricePlanMap: parseBillingPricePlanMap(getEnv("BILLING_PRICE_PLAN_MAP", env)),
  };

  return v.parse(WorkerConfigSchema, rawConfig);
}
