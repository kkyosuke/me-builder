import { d1 } from "@me-builder/lib";
import type { ChatTurnQueueMessage, Queue } from "@me-builder/shared";
import type { Env } from "../types";

export type CloudflareBindings = {
  d1: d1.Client;
  do: {
    conversation: Env["CONVERSATION_COORDINATOR"];
  };
  queue: {
    chatTurn: Queue<ChatTurnQueueMessage> | undefined;
  };
};

/** Workerへ注入されたCloudflare bindingを、アプリ内で使う名前へ集約する。 */
export function getCloudflareBindings(env: Env): CloudflareBindings {
  return {
    d1: d1.client.create(env.DB),
    do: {
      conversation: env.CONVERSATION_COORDINATOR,
    },
    queue: {
      chatTurn: env.CHAT_TURN_QUEUE,
    },
  };
}
