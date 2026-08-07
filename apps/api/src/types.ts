import type { D1Database } from "@cloudflare/workers-types";
import type {
  ConversationCoordinatorNamespace,
  Queue,
  WebhookQueueMessage,
} from "@me-builder/shared";

/** Wrangler生成bindingに、Secretと外部DOの公開RPC契約だけを重ねる。 */
type Env = Omit<ApiBindings, "DB" | "WEBHOOK_QUEUE" | "CONVERSATION_COORDINATOR"> & {
  ENVIRONMENT?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_WEBHOOK_URL?: string;
  LIFF_ID?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  BASE_URL?: string;
  WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;
  DB?: D1Database;
  CONVERSATION_COORDINATOR?: ConversationCoordinatorNamespace;
};

export type AppEnv = { Bindings: Env };
