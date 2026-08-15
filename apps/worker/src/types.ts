import type { Queue } from "@cloudflare/workers-types";
import type { AccountDataNamespace, CompatibilityDataNamespace, billing } from "@me-builder/lib";
import type {
  BrainVectorSyncQueueMessage,
  ChatTurnQueueMessage,
  DailyPromptQueueMessage,
  DiaryBrainCheckpointQueueMessage,
  ProfileSummaryGenerationQueueMessage,
} from "@me-builder/shared";

/** Wrangler生成bindingに、dashboardから配布するSecretとQueue本文型だけを重ねる。 */
export type Env = Omit<
  WorkerBindings,
  | "CHAT_TURN_QUEUE"
  | "BRAIN_CHECKPOINT_QUEUE"
  | "BRAIN_VECTOR_QUEUE"
  | "PROFILE_SUMMARY_QUEUE"
  | "DAILY_PROMPT_QUEUE"
  | "BRAIN_VECTOR_INDEX"
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
  STRIPE_SECRET_KEY?: string;
  BILLING_PRICE_PLAN_MAP?: string;
  GOOGLE_VERTEX_AI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_EMBEDDING_MODEL?: string;
  BRAIN_VECTOR_HMAC_SECRET?: string;
  CHAT_DELIVERY_SECRET?: string;
  CHAT_CONTEXT_MESSAGE_LIMIT?: string;
  LIFF_ID?: string;
  CHAT_TURN_QUEUE?: Queue<ChatTurnQueueMessage>;
  BRAIN_CHECKPOINT_QUEUE?: Queue<DiaryBrainCheckpointQueueMessage>;
  BRAIN_VECTOR_QUEUE?: Queue<BrainVectorSyncQueueMessage>;
  PROFILE_SUMMARY_QUEUE?: Queue<ProfileSummaryGenerationQueueMessage>;
  DAILY_PROMPT_QUEUE?: Queue<DailyPromptQueueMessage>;
  BRAIN_VECTOR_INDEX?: WorkerBindings["BRAIN_VECTOR_INDEX"];
  CONVERSATION_COORDINATOR?: WorkerBindings["CONVERSATION_COORDINATOR"];
  ACCOUNT_DATA?: AccountDataNamespace;
  COMPATIBILITY_DATA?: CompatibilityDataNamespace;
  /** テスト・previewの注入境界。未指定時はFreeへ安全に縮退する。 */
  ACCOUNT_PLAN_ASSIGNMENT_PROVIDER?: billing.AccountPlanAssignmentProvider;
};
