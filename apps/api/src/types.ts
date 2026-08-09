import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import type { AvatarQueueMessage, Queue, WebhookQueueMessage } from "@me-builder/shared";

/** Wrangler生成bindingに、SecretとQueueの公開契約だけを重ねる。 */
type Env = Omit<ApiBindings, "DB" | "WEBHOOK_QUEUE" | "ACCOUNT_DATA" | "COMPATIBILITY_DATA"> & {
  ENVIRONMENT?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_WEBHOOK_URL?: string;
  LIFF_ID?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  ADMIN_LINE_USER_IDS?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_APP_API_TOKEN?: string;
  BASE_URL?: string;
  WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;
  AVATAR_QUEUE?: Queue<AvatarQueueMessage>;
  AVATAR_BUCKET?: ApiBindings["AVATAR_BUCKET"];
  IMAGES?: ApiBindings["IMAGES"];
  DB?: ApiBindings["DB"];
  ACCOUNT_DATA?: AccountDataNamespace;
  COMPATIBILITY_DATA?: CompatibilityDataNamespace;
};

export type AppEnv = { Bindings: Env };
