import { getEnv } from "@me-builder/shared";
import * as v from "valibot";
import { type WorkerConfig, WorkerConfigSchema } from "./schema";

export { WorkerConfigSchema, type WorkerConfig };

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

  const rawConfig = {
    environment: rawEnvironment,
    baseDomain: rawBaseDomain,
    baseUrl: rawBaseUrl,
    apiUrl: rawApiUrl,
    lineChannelAccessToken: rawLineChannelAccessToken,
  };

  return v.parse(WorkerConfigSchema, rawConfig);
}

export const config = getWorkerConfig();
