import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import type {
  ProfileSummaryGenerationQueueMessage,
  Queue,
  SafeOperationalErrorFields,
  WebhookQueueMessage,
} from "@me-builder/shared";

/** Wrangler生成bindingに、SecretとQueueの公開契約だけを重ねる。 */
type Env = Omit<
  ApiBindings,
  | "DB"
  | "WEBHOOK_QUEUE"
  | "PROFILE_SUMMARY_QUEUE"
  | "ACCOUNT_DATA"
  | "COMPATIBILITY_DATA"
  | "BRAIN_VECTOR_INDEX"
> & {
  ENVIRONMENT?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_WEBHOOK_URL?: string;
  LIFF_ID?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  ADMIN_LINE_USER_IDS?: string;
  BASE_URL?: string;
  WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;
  PROFILE_SUMMARY_QUEUE?: Queue<ProfileSummaryGenerationQueueMessage>;
  DB?: D1Database;
  AVATAR_BUCKET?: R2Bucket;
  ACCOUNT_DATA?: AccountDataNamespace;
  COMPATIBILITY_DATA?: CompatibilityDataNamespace;
  BRAIN_VECTOR_INDEX?: ApiBindings["BRAIN_VECTOR_INDEX"];
};

export type AppEnv = {
  Bindings: Env;
  /** onErrorが分類したエラーを、終端ログを持つmiddlewareへ引き渡すための領域。 */
  Variables: { safeError?: SafeOperationalErrorFields };
};
