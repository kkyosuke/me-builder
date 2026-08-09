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

/** AI生成Queueには本文を含めず、認証済みAccountのData ObjectとTurnだけを参照させる。 */
export interface ChatTurnQueueMessage {
  type: "chat-turn";
  accountId: string;
  turnId: string;
  generationEpoch: number;
}

/** 本文を含めず、AccountDataに保存済みの会話checkpointだけを参照する。 */
export interface DiaryBrainCheckpointQueueMessage {
  type: "diary-brain-checkpoint";
  accountId: string;
  checkpointId: string;
}

export type { Queue, Message, MessageBatch };
