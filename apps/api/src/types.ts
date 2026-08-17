import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";
import type {
  AccountDataNamespace,
  CompatibilityDataNamespace,
  ConversationCoordinatorNamespace,
  billing,
} from "@me-builder/lib";
import type {
  BillingQueueMessage,
  Queue,
  ReflectionGenerationQueueMessage,
  SafeOperationalErrorFields,
  WebhookQueueMessage,
} from "@me-builder/shared";
import type { AuthenticatedActor, AuthenticationResult } from "./logic/authentication/types";

/** Wrangler生成bindingに、SecretとQueueの公開契約だけを重ねる。 */
type Env = Omit<
  ApiBindings,
  | "DB"
  | "SESSION_STORE"
  | "WEBHOOK_QUEUE"
  | "PROFILE_SUMMARY_QUEUE"
  | "BILLING_QUEUE"
  | "ACCOUNT_DATA"
  | "COMPATIBILITY_DATA"
  | "CONVERSATION_COORDINATOR"
  | "BRAIN_VECTOR_INDEX"
  | "WEB_ERROR_RATE_LIMITER"
  | "WEB_ORIGIN"
> & {
  ENVIRONMENT?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_WEBHOOK_URL?: string;
  LIFF_ID?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PORTAL_CONFIGURATION_ID?: string;
  STRIPE_PORTAL_PLAN_CHANGE_CONFIGURATION_ID?: string;
  STRIPE_PORTAL_RESET_CONFIGURATION_ID?: string;
  BILLING_PRICE_PLAN_MAP?: string;
  BILLING_LOOKUP_KEY_MAP?: string;
  BILLING_PROJECTION_STALE_AFTER_SECONDS?: string;
  ADMIN_LINE_USER_IDS?: string;
  BASE_URL?: string;
  WEB_ORIGIN?: string;
  SSO_ROLLOUT_MODE?: string;
  SSO_ISSUER_URL?: string;
  SSO_CLIENT_ID?: string;
  SSO_CLIENT_SECRET?: string;
  WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;
  PROFILE_SUMMARY_QUEUE?: Queue<ReflectionGenerationQueueMessage>;
  BILLING_QUEUE?: Queue<BillingQueueMessage>;
  DB?: D1Database;
  SESSION_STORE?: KVNamespace;
  AVATAR_BUCKET?: R2Bucket;
  ACCOUNT_DATA?: AccountDataNamespace;
  COMPATIBILITY_DATA?: CompatibilityDataNamespace;
  CONVERSATION_COORDINATOR?: ConversationCoordinatorNamespace;
  BRAIN_VECTOR_INDEX?: ApiBindings["BRAIN_VECTOR_INDEX"];
  /** Wrangler local以外では常に設定する。単体テストでは未設定へ縮退できる。 */
  WEB_ERROR_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  /** テスト・previewの注入境界。未指定時はFreeへ安全に縮退する。 */
  ACCOUNT_PLAN_ASSIGNMENT_PROVIDER?: billing.AccountPlanAssignmentProvider;
};

export type AppEnv = {
  Bindings: Env;
  /** onErrorが分類したエラーを、終端ログを持つmiddlewareへ引き渡すための領域。 */
  Variables: {
    safeError?: SafeOperationalErrorFields;
    /** 専用の処理終端ログをrouteが出力し、通常のHTTP終端ログを重ねない場合に使う。 */
    terminalLogOwnedByRoute?: boolean;
    authenticatedActor?: AuthenticatedActor;
    authenticationResult?: AuthenticationResult;
    authenticationSource?: "application-session";
    applicationSessionToken?: string;
  };
};
