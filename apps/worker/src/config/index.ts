import { getEnv, logger } from "@me-builder/shared";
import * as v from "valibot";
import {
  DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  DEFAULT_CLOUDFLARE_AI_GATEWAY_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  type WorkerConfig,
  WorkerConfigSchema,
} from "./schema";

export {
  DEFAULT_CLOUDFLARE_AI_GATEWAY_BASE_URL,
  DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  DEFAULT_GEMINI_MODEL,
  WorkerConfigSchema,
  type WorkerConfig,
};
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
  // 空文字は「未設定」として扱い、返信にリンクを添えないようにします。
  const rawLiffId = getEnv("LIFF_ID", env)?.trim() || undefined;
  const rawGoogleVertexAiApiKey = getEnv("GOOGLE_VERTEX_AI_API_KEY", env)?.trim() || undefined;
  const rawCloudflareAiGatewayToken = getEnv("CLOUDFLARE_APP_API_TOKEN", env)?.trim() || undefined;
  const rawCloudflareAiGatewayBaseUrl =
    getEnv("CF_AI_GATEWAY_BASE_URL", env)?.trim() || DEFAULT_CLOUDFLARE_AI_GATEWAY_BASE_URL;
  const rawGeminiModel = getEnv("GEMINI_MODEL", env)?.trim() || DEFAULT_GEMINI_MODEL;
  const rawChatEnabled = getEnv("CHAT_ENABLED", env)?.trim().toLowerCase() !== "false";
  const rawChatDeliverySecret = getEnv("CHAT_DELIVERY_SECRET", env)?.trim() || undefined;
  const rawChatContextMessageLimit = getEnv("CHAT_CONTEXT_MESSAGE_LIMIT", env)?.trim();
  const adminLineUserIds = (getEnv("ADMIN_LINE_USER_IDS", env) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const rawConfig = {
    environment: rawEnvironment,
    baseDomain: rawBaseDomain,
    baseUrl: rawBaseUrl,
    apiUrl: rawApiUrl,
    lineChannelAccessToken: rawLineChannelAccessToken,
    liffId: rawLiffId,
    googleVertexAiApiKey: rawGoogleVertexAiApiKey,
    cloudflareAiGatewayToken: rawCloudflareAiGatewayToken,
    cloudflareAiGatewayBaseUrl: rawCloudflareAiGatewayBaseUrl,
    geminiModel: rawGeminiModel,
    chatEnabled: rawChatEnabled,
    chatDeliverySecret: rawChatDeliverySecret,
    chatContextMessageLimit: parsePositiveInteger(
      rawChatContextMessageLimit,
      DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
    ),
    adminLineUserIds,
  };

  return v.parse(WorkerConfigSchema, rawConfig);
}
