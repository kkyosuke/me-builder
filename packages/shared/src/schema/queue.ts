import type { Message, MessageBatch, Queue } from "@cloudflare/workers-types";

export interface WebhookQueueMessage {
  id: string;
  source: string;
  receivedAt: string;
  payload: unknown;
  /** APIで確定したrouting。省略形はdeploy中に残る旧messageとの互換用。 */
  routing?: {
    lineTextEvents: Array<{
      eventId: string;
      intent: "diagnosis-request" | "diary";
    }>;
  };
}

/** AI生成Queueには本文やAccount識別子を含めず、D1のTurnだけを参照させる。 */
export interface ChatTurnQueueMessage {
  type: "chat-turn";
  turnId: string;
  generationEpoch: number;
}

export type { Queue, Message, MessageBatch };
