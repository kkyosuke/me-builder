import type { Queue } from "@cloudflare/workers-types";
import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import type { ChatTurnQueueMessage, DiaryBrainCheckpointQueueMessage } from "@me-builder/shared";

/** Wrangler生成bindingに、dashboardから配布するSecretとQueue本文型だけを重ねる。 */
export type Env = Omit<
  WorkerBindings,
  | "CHAT_TURN_QUEUE"
  | "BRAIN_CHECKPOINT_QUEUE"
  | "CONVERSATION_COORDINATOR"
  | "ACCOUNT_DATA"
  | "COMPATIBILITY_DATA"
  | "ENVIRONMENT"
> & {
  ENVIRONMENT?: string;
  BASE_DOMAIN?: string;
  BASE_URL?: string;
  API_URL?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  GOOGLE_VERTEX_AI_API_KEY?: string;
  GEMINI_MODEL?: string;
  CHAT_ENABLED?: string;
  CHAT_DELIVERY_SECRET?: string;
  PREVIEW_RESET_TOKEN?: string;
  CHAT_CONTEXT_MESSAGE_LIMIT?: string;
  LIFF_ID?: string;
  CHAT_TURN_QUEUE?: Queue<ChatTurnQueueMessage>;
  BRAIN_CHECKPOINT_QUEUE?: Queue<DiaryBrainCheckpointQueueMessage>;
  CONVERSATION_COORDINATOR?: WorkerBindings["CONVERSATION_COORDINATOR"];
  ACCOUNT_DATA?: AccountDataNamespace;
  COMPATIBILITY_DATA?: CompatibilityDataNamespace;
};
