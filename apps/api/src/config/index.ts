import { resolveLiffConfiguration } from "@me-builder/lib";
import { getEnv, parseAdminLineUserIds } from "@me-builder/shared";
import * as v from "valibot";
import { type ApiConfig, ConfigSchema } from "./schema";

export { ConfigSchema, type ApiConfig };

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

export function isDevelopmentEnvironment(environment: string): boolean {
  return DEVELOPMENT_ENVIRONMENTS.has(environment);
}

/**
 * API サーバーの環境変数を取得・整理し、Valibot で検証・整形した設定オブジェクトを生成します。
 * @me-builder/shared の getEnv を使用して Cloudflare (env) とローカル (process.env) の差分を吸収します。
 */
export function getConfig(env?: Record<string, unknown>): ApiConfig {
  const rawEnvironment = getEnv(["ENVIRONMENT", "NODE_ENV"], env);
  const rawPort = getEnv("PORT", env);
  const rawLineChannelAccessToken = getEnv("LINE_CHANNEL_ACCESS_TOKEN", env);
  const rawLineChannelSecret = getEnv("LINE_CHANNEL_SECRET", env);
  const rawBaseDomain = getEnv("BASE_DOMAIN", env);
  const rawWebOrigin = getEnv("WEB_ORIGIN", env)?.trim() || undefined;
  let rawBaseUrl = getEnv("BASE_URL", env);

  if ((!rawBaseUrl || rawBaseUrl === "/") && rawBaseDomain) {
    const domain = rawBaseDomain.startsWith("http")
      ? rawBaseDomain
      : rawBaseDomain.startsWith("api.")
        ? `https://${rawBaseDomain}`
        : `https://api.${rawBaseDomain}`;
    rawBaseUrl = domain;
  }

  let rawLineWebhookUrl = getEnv("LINE_WEBHOOK_URL", env);

  if (!rawLineWebhookUrl && rawBaseUrl) {
    rawLineWebhookUrl = `${rawBaseUrl.replace(/\/$/, "")}/api/line/webhook`;
  }

  const rawWebhookQueueName = getEnv(["WEBHOOK_QUEUE_NAME", "WEBHOOK_QUEUE"], env);
  const rawWebhookQueue = env?.WEBHOOK_QUEUE;
  const rawBillingQueue = env?.BILLING_QUEUE;

  const liffConfiguration = resolveLiffConfiguration({
    liffId: getEnv("LIFF_ID", env),
    lineLoginChannelId: getEnv("LINE_LOGIN_CHANNEL_ID", env),
  });
  const adminLineUserIds = parseAdminLineUserIds(getEnv("ADMIN_LINE_USER_IDS", env));

  const rawConfig = {
    port: rawPort,
    environment: rawEnvironment,
    lineChannelAccessToken: rawLineChannelAccessToken,
    lineChannelSecret: rawLineChannelSecret,
    baseDomain: rawBaseDomain,
    baseUrl: rawBaseUrl,
    webOrigin: rawWebOrigin,
    lineWebhookUrl: rawLineWebhookUrl,
    webhookQueueName: rawWebhookQueueName,
    webhookQueue: rawWebhookQueue,
    billingQueue: rawBillingQueue,
    stripeSecretKey: getEnv("STRIPE_SECRET_KEY", env),
    stripeWebhookSecret: getEnv("STRIPE_WEBHOOK_SECRET", env),
    liffId: liffConfiguration.liffId,
    lineLoginChannelId: liffConfiguration.lineLoginChannelId,
    adminLineUserIds,
  };

  return v.parse(ConfigSchema, rawConfig);
}

export const config = getConfig();
