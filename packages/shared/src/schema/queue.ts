import type { Message, MessageBatch, Queue } from "@cloudflare/workers-types";

export interface WebhookQueueMessage {
  id: string;
  source: string;
  receivedAt: string;
  payload: unknown;
}

/** AI生成Queueには本文やAccount識別子を含めず、D1のTurnだけを参照させる。 */
export interface ChatTurnQueueMessage {
  type: "chat-turn";
  turnId: string;
  generationEpoch: number;
}

export type { Queue, Message, MessageBatch };
