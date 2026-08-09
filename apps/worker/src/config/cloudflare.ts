import { d1 } from "@me-builder/lib";
import type { AccountDataNamespace } from "@me-builder/lib";
import type {
  AvatarQueueMessage,
  ChatTurnQueueMessage,
  DiaryBrainCheckpointQueueMessage,
  Queue,
} from "@me-builder/shared";
import type { Env } from "../types";

export type CloudflareBindings = {
  d1: d1.Client;
  do: {
    conversation: Env["CONVERSATION_COORDINATOR"];
    accountData?: AccountDataNamespace;
  };
  queue: {
    chatTurn: Queue<ChatTurnQueueMessage> | undefined;
    brainCheckpoint: Queue<DiaryBrainCheckpointQueueMessage> | undefined;
    avatar?: Queue<AvatarQueueMessage> | undefined;
  };
  avatar?: {
    bucket: R2Bucket | undefined;
    images: ImagesBinding | undefined;
  };
};

/** Workerへ注入されたCloudflare bindingを、アプリ内で使う名前へ集約する。 */
export function getCloudflareBindings(env: Env): CloudflareBindings {
  return {
    d1: d1.client.create(env.DB),
    do: {
      conversation: env.CONVERSATION_COORDINATOR,
      ...(env.ACCOUNT_DATA ? { accountData: env.ACCOUNT_DATA } : {}),
    },
    queue: {
      chatTurn: env.CHAT_TURN_QUEUE,
      brainCheckpoint: env.BRAIN_CHECKPOINT_QUEUE,
      avatar: env.AVATAR_QUEUE,
    },
    avatar: {
      bucket: env.AVATAR_BUCKET,
      images: env.IMAGES,
    },
  };
}
