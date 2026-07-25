import * as v from "valibot";

export const WebConfigSchema = v.object({
  environment: v.optional(v.string(), "development"),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  apiUrl: v.optional(v.string()),
});

export type WebConfig = v.InferOutput<typeof WebConfigSchema>;

/**
 * Web UI の環境変数を取得・整理し、Valibot で検証・整形した設定オブジェクトを生成します。
 */
export function getWebConfig(env?: Record<string, string | undefined>): WebConfig {
  const getEnv = (key: string): string | undefined => {
    if (env && Object.prototype.hasOwnProperty.call(env, key)) {
      return env[key];
    }
    const metaEnv =
      typeof import.meta !== "undefined"
        ? (import.meta as { env?: Record<string, string> }).env
        : undefined;
    return (
      metaEnv?.[`VITE_${key}`] ||
      metaEnv?.[key] ||
      (typeof process !== "undefined" ? process.env?.[key] : undefined)
    );
  };

  const rawEnvironment = getEnv("ENVIRONMENT") || getEnv("NODE_ENV");
  const rawBaseDomain = getEnv("BASE_DOMAIN");
  let rawBaseUrl = getEnv("BASE_URL");
  let rawApiUrl = getEnv("API_URL");

  if ((!rawBaseUrl || rawBaseUrl === "/") && rawBaseDomain) {
    const domain = rawBaseDomain.startsWith("http") ? rawBaseDomain : `https://${rawBaseDomain}`;
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

  const rawConfig = {
    environment: rawEnvironment,
    baseDomain: rawBaseDomain,
    baseUrl: rawBaseUrl,
    apiUrl: rawApiUrl,
  };

  return v.parse(WebConfigSchema, rawConfig);
}

export const config = getWebConfig();
