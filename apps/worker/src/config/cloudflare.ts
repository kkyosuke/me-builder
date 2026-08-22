import { D1, billing } from "@me-builder/lib";
import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
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
  avatarBucket?: Env["AVATAR_BUCKET"];
  photoDiaryBucket?: Env["PHOTO_DIARY_BUCKET"];
  images?: Env["IMAGES"];
  planAssignmentProvider?: billing.AccountPlanAssignmentProvider;
  do: {
    conversation: Env["CONVERSATION_COORDINATOR"];
    accountData?: AccountDataNamespace;
    compatibilityData?: CompatibilityDataNamespace;
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
  const d1 = D1.shared.client.create(env.DB);
  const subscriptionAssignments = new D1.shared.action.billing.D1AccountPlanAssignmentProvider(d1);
  return {
    d1,
    ...(env.AVATAR_BUCKET ? { avatarBucket: env.AVATAR_BUCKET } : {}),
    ...(env.PHOTO_DIARY_BUCKET ? { photoDiaryBucket: env.PHOTO_DIARY_BUCKET } : {}),
    ...(env.IMAGES ? { images: env.IMAGES } : {}),
    planAssignmentProvider: new billing.FamilyAwareAccountPlanAssignmentProvider(
      d1,
      env.ACCOUNT_PLAN_ASSIGNMENT_PROVIDER ?? subscriptionAssignments,
    ),
    do: {
      conversation: env.CONVERSATION_COORDINATOR,
      ...(env.ACCOUNT_DATA ? { accountData: env.ACCOUNT_DATA } : {}),
      ...(env.COMPATIBILITY_DATA ? { compatibilityData: env.COMPATIBILITY_DATA } : {}),
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
