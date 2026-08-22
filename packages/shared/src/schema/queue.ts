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

/** 本文やR2 keyをQueueへ複製せず、AccountDataの削除対象だけを参照する。 */
export interface PhotoDiaryDeletionQueueMessage {
  type: "photo-diary-deletion";
  accountId: string;
  mediaId: string;
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

/** 本文を含めず、AccountDataのVector同期outboxだけを参照する。 */
export interface BrainVectorSyncQueueMessage {
  type: "brain-vector-sync";
  accountId: string;
  jobId: string;
  brainItemId: string;
  itemRevision: number;
}

/** 本文を含めず、AccountDataに保存済みの生成要求だけを参照する。 */
export interface ProfileSummaryGenerationQueueMessage {
  type: "profile-summary-generation";
  accountId: string;
  generationId: string;
}

/** 本文を含めず、AccountDataに保存済みの週次振り返り生成要求だけを参照する。 */
export interface WeeklyReflectionGenerationQueueMessage {
  type: "weekly-reflection-generation";
  accountId: string;
  generationId: string;
}

export type ReflectionGenerationQueueMessage =
  | ProfileSummaryGenerationQueueMessage
  | WeeklyReflectionGenerationQueueMessage;

/** 本文やLINE identityを含めず、AccountDataで当日の配送可否を再判定する。 */
export interface DailyPromptQueueMessage {
  type: "daily-prompt";
  accountId: string;
  /** Asia/Tokyoで解決済みのYYYY-MM-DD。 */
  localDate: string;
  /** Asia/Tokyoの候補時刻。省略形は18時固定だった既存messageとの互換用。 */
  localHour?: number;
}

/** Stripe本文を持たず、署名検証済みeventの再取得に必要な参照だけを渡す。 */
export interface BillingQueueMessage {
  type: "billing-event";
  /** 未指定はdeploy中の初期messageとの互換のためversion 1として扱う。 */
  version?: 1;
  traceId: string;
  eventId: string;
  eventType: string;
  objectId: string;
  objectType: string;
  customerId: string | null;
  subscriptionId: string | null;
  createdAt: string;
}

export type { Queue, Message, MessageBatch };
