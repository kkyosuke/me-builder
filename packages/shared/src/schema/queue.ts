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

/** 本文を含めず、AccountDataのVector同期outboxだけを参照する。 */
export interface BrainVectorSyncQueueMessage {
  type: "brain-vector-sync";
  accountId: string;
  jobId: string;
  brainItemId: string;
  itemRevision: number;
}

export type { Queue, Message, MessageBatch };
