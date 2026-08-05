import * as v from "valibot";
import { type WebConfig, WebConfigSchema } from "./schema";

export { WebConfigSchema, type WebConfig };

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
    const processEnv = typeof process !== "undefined" ? process.env : undefined;
    return (
      metaEnv?.[`VITE_${key}`] || metaEnv?.[key] || processEnv?.[`VITE_${key}`] || processEnv?.[key]
    );
  };

  // 開発用データ操作の判定に使うため、NODE_ENVから暗黙補完しません。
  const rawEnvironment = getEnv("ENVIRONMENT");
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

  // 空文字は「未設定」として扱い、LIFF 初期化をスキップできるようにします。
  const rawLiffId = getEnv("LIFF_ID")?.trim() || undefined;

  const rawConfig = {
    environment: rawEnvironment,
    baseDomain: rawBaseDomain,
    baseUrl: rawBaseUrl,
    apiUrl: rawApiUrl,
    liffId: rawLiffId,
  };

  return v.parse(WebConfigSchema, rawConfig);
}

export const config = getWebConfig();
