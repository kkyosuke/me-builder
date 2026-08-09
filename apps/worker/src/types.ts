import type { Queue } from "@cloudflare/workers-types";
import type { AccountDataNamespace } from "@me-builder/lib";
import type { ChatTurnQueueMessage, DiaryBrainCheckpointQueueMessage } from "@me-builder/shared";

/** Wrangler生成bindingに、dashboardから配布するSecretとQueue本文型だけを重ねる。 */
export type Env = Omit<
  WorkerBindings,
  "CHAT_TURN_QUEUE" | "CONVERSATION_COORDINATOR" | "ACCOUNT_DATA" | "ENVIRONMENT"
> & {
  ENVIRONMENT?: string;
  BASE_DOMAIN?: string;
  BASE_URL?: string;
  API_URL?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  GOOGLE_AI_STUDIO_API_KEY?: string;
  CLOUDFLARE_APP_API_TOKEN?: string;
  CF_AI_GATEWAY_BASE_URL?: string;
  GEMINI_MODEL?: string;
  CHAT_ENABLED?: string;
  CHAT_DELIVERY_SECRET?: string;
  CHAT_CONTEXT_MESSAGE_LIMIT?: string;
  LIFF_ID?: string;
  CHAT_TURN_QUEUE?: Queue<ChatTurnQueueMessage | DiaryBrainCheckpointQueueMessage>;
  CONVERSATION_COORDINATOR?: WorkerBindings["CONVERSATION_COORDINATOR"];
  ACCOUNT_DATA?: AccountDataNamespace;
};
