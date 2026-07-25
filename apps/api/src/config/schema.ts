import * as v from "valibot";

export const rawSchema = v.object({
  PORT: v.optional(v.string()),
  ENVIRONMENT: v.optional(v.string()),
  LINE_CHANNEL_ACCESS_TOKEN: v.optional(v.string()),
  BASE_DOMAIN: v.optional(v.string()),
  BASE_URL: v.optional(v.string()),
  LINE_WEBHOOK_URL: v.optional(v.string()),
});

export type RawConfig = v.InferOutput<typeof rawSchema>;

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
 * 回収した生の環境変数を元に URL 補完・整形を行い、Valibot で検証した ApiConfig を組み立てます。
 */
export function buildConfig(rawEnv: RawConfig): ApiConfig {
  const parsedRaw = v.parse(rawSchema, rawEnv);
  const rawEnvironment = parsedRaw.ENVIRONMENT;
  const rawPort = parsedRaw.PORT;
  const rawLineChannelAccessToken = parsedRaw.LINE_CHANNEL_ACCESS_TOKEN;
  const rawBaseDomain = parsedRaw.BASE_DOMAIN;
  let rawBaseUrl = parsedRaw.BASE_URL;

  if ((!rawBaseUrl || rawBaseUrl === "/") && rawBaseDomain) {
    const domain = rawBaseDomain.startsWith("http")
      ? rawBaseDomain
      : rawBaseDomain.startsWith("api.")
        ? `https://${rawBaseDomain}`
        : `https://api.${rawBaseDomain}`;
    rawBaseUrl = domain;
  }

  let rawLineWebhookUrl = parsedRaw.LINE_WEBHOOK_URL;

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
