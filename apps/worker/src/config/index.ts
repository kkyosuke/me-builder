import { getEnv } from "@me-builder/shared";
import * as v from "valibot";
import {
  DEFAULT_CLOUDFLARE_AI_GATEWAY_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  type WorkerConfig,
  WorkerConfigSchema,
} from "./schema";

export {
  DEFAULT_CLOUDFLARE_AI_GATEWAY_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  WorkerConfigSchema,
  type WorkerConfig,
};
export { type CloudflareBindings, getCloudflareBindings } from "./cloudflare";

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
  const rawGoogleAiStudioApiKey = getEnv("GOOGLE_AI_STUDIO_API_KEY", env)?.trim() || undefined;
  const rawCloudflareAiGatewayToken = getEnv("CLOUDFLARE_AIG_TOKEN", env)?.trim() || undefined;
  const rawCloudflareAiGatewayBaseUrl =
    getEnv("CF_AI_GATEWAY_BASE_URL", env)?.trim() || DEFAULT_CLOUDFLARE_AI_GATEWAY_BASE_URL;
  const rawGeminiModel = getEnv("GEMINI_MODEL", env)?.trim() || DEFAULT_GEMINI_MODEL;
  const rawChatEnabled = getEnv("CHAT_ENABLED", env)?.trim().toLowerCase() !== "false";
  const rawChatDeliverySecret = getEnv("CHAT_DELIVERY_SECRET", env)?.trim() || undefined;

  const rawConfig = {
    environment: rawEnvironment,
    baseDomain: rawBaseDomain,
    baseUrl: rawBaseUrl,
    apiUrl: rawApiUrl,
    lineChannelAccessToken: rawLineChannelAccessToken,
    liffId: rawLiffId,
    googleAiStudioApiKey: rawGoogleAiStudioApiKey,
    cloudflareAiGatewayToken: rawCloudflareAiGatewayToken,
    cloudflareAiGatewayBaseUrl: rawCloudflareAiGatewayBaseUrl,
    geminiModel: rawGeminiModel,
    chatEnabled: rawChatEnabled,
    chatDeliverySecret: rawChatDeliverySecret,
  };

  return v.parse(WorkerConfigSchema, rawConfig);
}
