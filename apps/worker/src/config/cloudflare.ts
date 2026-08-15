import { D1, billing } from "@me-builder/lib";
import type { AccountDataNamespace } from "@me-builder/lib";
import type {
  BrainVectorSyncQueueMessage,
  ChatTurnQueueMessage,
  DailyPromptQueueMessage,
  DiaryBrainCheckpointQueueMessage,
  Queue,
} from "@me-builder/shared";
import type { Env } from "../types";

export type CloudflareBindings = {
  d1: D1.shared.Client;
  planAssignmentProvider?: billing.AccountPlanAssignmentProvider;
  do: {
    conversation: Env["CONVERSATION_COORDINATOR"];
    accountData?: AccountDataNamespace;
  };
  queue: {
    chatTurn: Queue<ChatTurnQueueMessage> | undefined;
    brainCheckpoint: Queue<DiaryBrainCheckpointQueueMessage> | undefined;
    brainVector?: Queue<BrainVectorSyncQueueMessage> | undefined;
    dailyPrompt?: Queue<DailyPromptQueueMessage> | undefined;
  };
  vector?: { brain: Env["BRAIN_VECTOR_INDEX"] };
};

/** Workerへ注入されたCloudflare bindingを、アプリ内で使う名前へ集約する。 */
export function getCloudflareBindings(env: Env): CloudflareBindings {
  return {
    d1: D1.shared.client.create(env.DB),
    planAssignmentProvider:
      env.ACCOUNT_PLAN_ASSIGNMENT_PROVIDER ?? new billing.FakeAccountPlanAssignmentProvider(),
    do: {
      conversation: env.CONVERSATION_COORDINATOR,
      ...(env.ACCOUNT_DATA ? { accountData: env.ACCOUNT_DATA } : {}),
    },
    queue: {
      chatTurn: env.CHAT_TURN_QUEUE,
      brainCheckpoint: env.BRAIN_CHECKPOINT_QUEUE,
      brainVector: env.BRAIN_VECTOR_QUEUE,
      dailyPrompt: env.DAILY_PROMPT_QUEUE,
    },
    vector: { brain: env.BRAIN_VECTOR_INDEX },
  };
}
