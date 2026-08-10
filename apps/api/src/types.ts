import type { D1Database, DurableObjectId } from "@cloudflare/workers-types";
import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import type { Queue, SafeOperationalErrorFields, WebhookQueueMessage } from "@me-builder/shared";

/** Wrangler生成bindingに、SecretとQueueの公開契約だけを重ねる。 */
export interface ResettableDurableObjectNamespace {
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId): {
    resetStorage(token: string): Promise<void>;
    restartAfterReset(token: string): Promise<never>;
  };
}

type Env = Omit<
  ApiBindings,
  "DB" | "WEBHOOK_QUEUE" | "ACCOUNT_DATA" | "COMPATIBILITY_DATA" | "CONVERSATION_COORDINATOR"
> & {
  ENVIRONMENT?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_WEBHOOK_URL?: string;
  LIFF_ID?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  ADMIN_LINE_USER_IDS?: string;
  BASE_URL?: string;
  PREVIEW_RESET_TOKEN?: string;
  WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;
  DB?: D1Database;
  ACCOUNT_DATA?: AccountDataNamespace & ResettableDurableObjectNamespace;
  COMPATIBILITY_DATA?: CompatibilityDataNamespace & ResettableDurableObjectNamespace;
  CONVERSATION_COORDINATOR?: ResettableDurableObjectNamespace;
};

export type AppEnv = {
  Bindings: Env;
  /** onErrorが分類したエラーを、終端ログを持つmiddlewareへ引き渡すための領域。 */
  Variables: { safeError?: SafeOperationalErrorFields };
};
