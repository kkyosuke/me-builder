import type { Message, MessageBatch, Queue } from "@cloudflare/workers-types";

/** D1の100 bind parameter制限内で、1 Turnのmessage insertと相関IDを有界に保つ。 */
export const MAX_CHAT_TURN_TRACE_IDS = 6;

export interface WebhookQueueMessage {
  id: string;
  /** API受付から後続の非同期処理まで引き継ぐ。省略形は既存messageとの互換用。 */
  traceId?: string;
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
  /** Webhookから引き継ぐ相関ID。省略形は既存messageとの互換用。 */
  traceId?: string;
  /** 連投を1つのTurnへ統合した場合の全相関ID。省略形は既存messageとの互換用。 */
  traceIds?: string[];
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

/** Avatar Queueには画像本文や外部の本人識別子を含めず、AccountDataとJobだけを参照させる。 */
export interface AvatarQueueMessage {
  type: "avatar";
  /** アップロード受付で発行したJob IDを相関IDとして後続生成まで引き継ぐ。 */
  traceId?: string;
  operation: "person-check" | "generate";
  accountId: string;
  jobId: string;
}

export type { Queue, Message, MessageBatch };
