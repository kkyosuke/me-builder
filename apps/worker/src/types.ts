import type { D1Database, DurableObjectNamespace, Queue } from "@cloudflare/workers-types";
import type { ChatTurnQueueMessage } from "@me-builder/shared";
import type { ConversationCoordinator } from "./conversation-coordinator";

export interface Env {
  ENVIRONMENT?: string;
  BASE_DOMAIN?: string;
  BASE_URL?: string;
  API_URL?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  GOOGLE_AI_STUDIO_API_KEY?: string;
  CLOUDFLARE_AIG_TOKEN?: string;
  CF_AI_GATEWAY_BASE_URL?: string;
  GEMINI_MODEL?: string;
  CHAT_ENABLED?: string;
  CHAT_DELIVERY_SECRET?: string;
  CONVERSATION_COORDINATOR?: DurableObjectNamespace<ConversationCoordinator>;
  CHAT_TURN_QUEUE?: Queue<ChatTurnQueueMessage>;
  DB: D1Database;
}
