import { resolveLiffConfiguration } from "@me-builder/lib";
import { getEnv, parseAdminLineUserIds } from "@me-builder/shared";
import * as v from "valibot";
import { type ApiConfig, ConfigSchema } from "./schema";

export { ConfigSchema, type ApiConfig };

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

function parseBillingPricePlanMap(
  raw: string | undefined,
): Record<string, "lite" | "full" | "family"> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, "lite" | "full" | "family"] =>
          entry[0].length > 0 && ["lite", "full", "family"].includes(String(entry[1])),
      ),
    );
  } catch {
    return {};
  }
}

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
    stripePortalConfigurationId: getEnv("STRIPE_PORTAL_CONFIGURATION_ID", env),
    stripePortalPlanChangeConfigurationId: getEnv(
      "STRIPE_PORTAL_PLAN_CHANGE_CONFIGURATION_ID",
      env,
    ),
    stripePortalResetConfigurationId: getEnv("STRIPE_PORTAL_RESET_CONFIGURATION_ID", env),
    billingPricePlanMap: parseBillingPricePlanMap(getEnv("BILLING_PRICE_PLAN_MAP", env)),
    billingProjectionStaleAfterSeconds: Number(
      getEnv("BILLING_PROJECTION_STALE_AFTER_SECONDS", env)?.trim() || 900,
    ),
    liffId: liffConfiguration.liffId,
    lineLoginChannelId: liffConfiguration.lineLoginChannelId,
    ssoRolloutMode: getEnv("SSO_ROLLOUT_MODE", env)?.trim() || undefined,
    ssoRolloutPercent: Number(getEnv("SSO_ROLLOUT_PERCENT", env) ?? 0),
    googleIdentityPlatformApiKey:
      getEnv("GOOGLE_IDENTITY_PLATFORM_API_KEY", env)?.trim() || undefined,
    googleOAuthClientId: getEnv("GOOGLE_OAUTH_CLIENT_ID", env)?.trim() || undefined,
    googleOAuthClientSecret: getEnv("GOOGLE_OAUTH_CLIENT_SECRET", env)?.trim() || undefined,
    ssoCallbackUrl:
      rawBaseUrl && rawBaseUrl !== "/"
        ? `${rawBaseUrl.replace(/\/$/u, "")}/api/auth/sso/callback`
        : undefined,
    mcpResourceUrl:
      getEnv("MCP_RESOURCE_URL", env)?.trim() ||
      (rawBaseDomain && rawBaseDomain !== "localhost"
        ? `https://mcp.${rawBaseDomain.replace(/^https?:\/\//, "")}/mcp`
        : undefined),
    mcpFeatureEnabled: getEnv("MCP_FEATURE_ENABLED", env)?.trim() === "true",
    adminLineUserIds,
  };

  const parsed = v.parse(ConfigSchema, rawConfig);
  if (
    parsed.ssoRolloutMode !== "disabled" &&
    (!parsed.googleIdentityPlatformApiKey ||
      !parsed.googleOAuthClientId ||
      !parsed.googleOAuthClientSecret ||
      !parsed.ssoCallbackUrl ||
      !parsed.webOrigin)
  ) {
    throw new Error(
      "GOOGLE_IDENTITY_PLATFORM_API_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, BASE_URL, and WEB_ORIGIN are required when SSO is enabled",
    );
  }
  return parsed;
}

export const config = getConfig();
