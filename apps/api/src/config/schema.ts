import type { BillingQueueMessage, Queue, WebhookQueueMessage } from "@me-builder/shared";
import * as v from "valibot";

function isLoopbackHttpUrl(url: URL): boolean {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function isSecureOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || isLoopbackHttpUrl(url)) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isSsoCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || isLoopbackHttpUrl(url)) &&
      !url.username &&
      !url.password &&
      url.pathname === "/api/auth/sso/callback" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export const ConfigSchema = v.object({
  port: v.pipe(
    v.optional(v.string(), "3000"),
    v.transform((val) => Number(val) || 3000),
  ),
  environment: v.optional(v.string(), "development"),
  lineChannelAccessToken: v.optional(v.string()),
  lineChannelSecret: v.optional(v.string()),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  /** ブラウザからのCORSリクエストを許可するWeb UIのオリジン。 */
  webOrigin: v.optional(
    v.pipe(v.string(), v.url(), v.check(isSecureOrigin, "WEB_ORIGIN must be a secure origin")),
  ),
  lineWebhookUrl: v.optional(v.string()),
  /** LIFF ID。未設定の場合、LINE Login チャネル ID の補完元がなくなります。 */
  liffId: v.optional(v.string()),
  /** LINE Login チャネル ID。ID トークンの `aud` の期待値として使います。 */
  lineLoginChannelId: v.optional(v.string()),
  /** 外部ブラウザSSOの段階公開状態。disabledではSSO設定を要求しない。 */
  ssoRolloutMode: v.optional(v.picklist(["disabled", "linking", "linked-login"]), "disabled"),
  /** 管理者以外のlink済みAccountへSSO sessionを発行する安定割合。 */
  ssoRolloutPercent: v.optional(
    v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
    0,
  ),
  /** Identity Platform REST APIの環境別Web API key。 */
  googleIdentityPlatformApiKey: v.optional(v.pipe(v.string(), v.nonEmpty())),
  /** development/productionのuserを分離するIdentity Platform tenant ID。 */
  googleIdentityPlatformTenantId: v.optional(v.pipe(v.string(), v.nonEmpty())),
  /** Identity PlatformのGoogle providerへ登録した環境別OAuth client。 */
  googleOAuthClientId: v.optional(v.pipe(v.string(), v.nonEmpty())),
  googleOAuthClientSecret: v.optional(v.pipe(v.string(), v.nonEmpty())),
  ssoCallbackUrl: v.optional(
    v.pipe(
      v.string(),
      v.url(),
      v.check(isSsoCallback, "SSO callback must use the fixed secure callback path"),
    ),
  ),
  mcpResourceUrl: v.optional(v.pipe(v.string(), v.url())),
  mcpFeatureEnabled: v.optional(v.boolean(), false),
  photoDiaryStorageEnabled: v.optional(v.boolean(), false),
  /** カンマ区切りの設定値を解析した、管理者として扱うLINE user ID。 */
  adminLineUserIds: v.optional(v.array(v.string()), []),
  webhookQueueName: v.optional(v.string()),
  webhookQueue: v.optional(
    v.custom<Queue<WebhookQueueMessage>>(
      (val) => val === undefined || (typeof val === "object" && val !== null && "send" in val),
    ),
  ),
  stripeSecretKey: v.optional(v.string()),
  stripeWebhookSecret: v.optional(v.string()),
  stripePortalConfigurationId: v.optional(v.string()),
  stripePortalPlanChangeConfigurationId: v.optional(v.string()),
  stripePortalResetConfigurationId: v.optional(v.string()),
  billingQueue: v.optional(
    v.custom<Queue<BillingQueueMessage>>(
      (val) => val === undefined || (typeof val === "object" && val !== null && "send" in val),
    ),
  ),
  billingPricePlanMap: v.optional(v.record(v.string(), v.picklist(["lite", "full", "family"])), {}),
  billingProjectionStaleAfterSeconds: v.optional(
    v.pipe(v.number(), v.safeInteger(), v.minValue(60)),
    900,
  ),
});

export type ApiConfig = v.InferOutput<typeof ConfigSchema>;
