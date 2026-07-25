import * as v from "valibot";

export const ConfigSchema = v.object({
  port: v.pipe(
    v.optional(v.string(), "3000"),
    v.transform((val) => Number(val) || 3000),
  ),
  environment: v.optional(v.string(), "development"),
  lineChannelAccessToken: v.optional(v.string()),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  lineWebhookUrl: v.optional(v.string()),
});

export type ApiConfig = v.InferOutput<typeof ConfigSchema>;

/**
 * 環境変数を取得・整理し、Valibot で検証・整形した設定オブジェクトを生成します。
 * Hono の c.env や process.env から値を取得します。
 */
export function getConfig(env?: Record<string, string | undefined>): ApiConfig {
  const getEnv = (key: string): string | undefined => {
    if (env && Object.prototype.hasOwnProperty.call(env, key)) {
      return env[key];
    }
    return typeof process !== "undefined" ? process.env?.[key] : undefined;
  };

  const rawEnvironment = getEnv("ENVIRONMENT") || getEnv("NODE_ENV");
  const rawPort = getEnv("PORT");
  const rawLineChannelAccessToken = getEnv("LINE_CHANNEL_ACCESS_TOKEN");
  const rawBaseDomain = getEnv("BASE_DOMAIN");
  let rawBaseUrl = getEnv("BASE_URL");

  if ((!rawBaseUrl || rawBaseUrl === "/") && rawBaseDomain) {
    const domain = rawBaseDomain.startsWith("http")
      ? rawBaseDomain
      : rawBaseDomain.startsWith("api.")
        ? `https://${rawBaseDomain}`
        : `https://api.${rawBaseDomain}`;
    rawBaseUrl = domain;
  }

  let rawLineWebhookUrl = getEnv("LINE_WEBHOOK_URL");

  if (!rawLineWebhookUrl && rawBaseUrl) {
    rawLineWebhookUrl = `${rawBaseUrl.replace(/\/$/, "")}/api/line/webhook`;
  }

  const rawConfig = {
    port: rawPort,
    environment: rawEnvironment,
    lineChannelAccessToken: rawLineChannelAccessToken,
    baseDomain: rawBaseDomain,
    baseUrl: rawBaseUrl,
    lineWebhookUrl: rawLineWebhookUrl,
  };

  return v.parse(ConfigSchema, rawConfig);
}

export const config = getConfig();
