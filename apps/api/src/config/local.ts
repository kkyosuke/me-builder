import type { RawConfig } from "./schema";

/**
 * ローカル環境 (process.env または overrideEnv) から環境変数の値を回収します。
 */
export function getLocalEnv(overrideEnv?: Record<string, string | undefined>): RawConfig {
  const getEnv = (key: string): string | undefined => {
    if (overrideEnv && Object.prototype.hasOwnProperty.call(overrideEnv, key)) {
      return overrideEnv[key];
    }
    return typeof process !== "undefined" ? process.env?.[key] : undefined;
  };

  return {
    PORT: getEnv("PORT"),
    ENVIRONMENT: getEnv("ENVIRONMENT") || getEnv("NODE_ENV"),
    LINE_CHANNEL_ACCESS_TOKEN: getEnv("LINE_CHANNEL_ACCESS_TOKEN"),
    BASE_DOMAIN: getEnv("BASE_DOMAIN"),
    BASE_URL: getEnv("BASE_URL"),
    LINE_WEBHOOK_URL: getEnv("LINE_WEBHOOK_URL"),
  };
}
