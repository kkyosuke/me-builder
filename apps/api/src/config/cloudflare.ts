import type { RawConfig } from "./schema";

/**
 * Cloudflare Workers 環境 (c.env バインディング) から環境変数の値を回収します。
 */
export function getCloudflareEnv(env: Record<string, string | undefined>): RawConfig {
  return {
    PORT: env.PORT,
    ENVIRONMENT: env.ENVIRONMENT || env.NODE_ENV,
    LINE_CHANNEL_ACCESS_TOKEN: env.LINE_CHANNEL_ACCESS_TOKEN,
    BASE_DOMAIN: env.BASE_DOMAIN,
    BASE_URL: env.BASE_URL,
    LINE_WEBHOOK_URL: env.LINE_WEBHOOK_URL,
  };
}
