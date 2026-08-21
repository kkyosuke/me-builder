import { line } from "@me-builder/lib";
import type { D1 } from "@me-builder/lib";
import {
  type BillingQueueMessage,
  type BrainVectorSyncQueueMessage,
  type ChatTurnQueueMessage,
  type DailyPromptQueueMessage,
  type DiaryBrainCheckpointQueueMessage,
  type FlowKey,
  type Message,
  type MessageBatch,
  type PhotoDiaryDeletionQueueMessage,
  type ProfileSummaryGenerationQueueMessage,
  type WebhookQueueMessage,
  type WeeklyReflectionGenerationQueueMessage,
  describeQueueMessageResult,
  logger,
  operationalLogLevel,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import { type CloudflareBindings, type WorkerConfig, getWorkerConfig } from "../config";
import { BILLING_QUEUE_MAX_ATTEMPTS, processBillingMessage } from "../handler/billing";
import { processBrainVectorSyncMessage } from "../handler/brain-vector-sync";
import { CHAT_TURN_MAX_ATTEMPTS, processChatTurnMessage } from "../handler/chat-turn";
import { DAILY_PROMPT_MAX_ATTEMPTS, processDailyPromptMessage } from "../handler/daily-prompt";
import {
  DIARY_BRAIN_CHECKPOINT_MAX_ATTEMPTS,
  processDiaryBrainCheckpointMessage,
} from "../handler/diary-brain-checkpoint";
import { processPhotoDiaryDeletionMessage } from "../handler/photo-diary-deletion";
import {
  PROFILE_SUMMARY_GENERATION_MAX_ATTEMPTS,
  processProfileSummaryGenerationMessage,
} from "../handler/profile-summary-generation";
import {
  WEEKLY_REFLECTION_MAX_ATTEMPTS,
  processWeeklyReflectionGenerationMessage,
} from "../handler/weekly-reflection-generation";
import { processLineWebhook } from "./feature/line";

/** 写真取得を含むため、約1時間内に初回と6回の配送機会を持つ。 */
export const WEBHOOK_QUEUE_MAX_ATTEMPTS = 7;
const WEBHOOK_RETRY_DELAYS_SECONDS = [10, 30, 120, 300, 900, 1_800] as const;

/**
 * 初回配送を含む最大試行回数。wrangler.tomlのmax_retriesと揃える。
 * 次の失敗でDLQへ落ちるかを終端ログ1行から判断できるようにするため、処理ごとに持つ。
 */
const MAX_ATTEMPTS_BY_FLOW: Record<FlowKey, number | undefined> = {
  "line-webhook": WEBHOOK_QUEUE_MAX_ATTEMPTS,
  "chat-turn": CHAT_TURN_MAX_ATTEMPTS,
  "diary-brain-checkpoint": DIARY_BRAIN_CHECKPOINT_MAX_ATTEMPTS,
  "brain-vector-sync": 6,
  "profile-summary-generation": PROFILE_SUMMARY_GENERATION_MAX_ATTEMPTS,
  "weekly-reflection-generation": WEEKLY_REFLECTION_MAX_ATTEMPTS,
  "daily-prompt": DAILY_PROMPT_MAX_ATTEMPTS,
  "photo-diary-deletion": 48,
  billing: BILLING_QUEUE_MAX_ATTEMPTS,
  "queue-dispatch": undefined,
};

/** どの処理のmessageだったかをログの見出しへ出すため、body形状から処理名を決める。 */
function flowOf(
  body:
    | WebhookQueueMessage
    | ChatTurnQueueMessage
    | DiaryBrainCheckpointQueueMessage
    | BrainVectorSyncQueueMessage
    | ProfileSummaryGenerationQueueMessage
    | WeeklyReflectionGenerationQueueMessage
    | DailyPromptQueueMessage
    | BillingQueueMessage
    | PhotoDiaryDeletionQueueMessage,
): FlowKey {
  if (!("type" in body)) return "line-webhook";
  if (body.type === "chat-turn") return "chat-turn";
  if (body.type === "diary-brain-checkpoint") return "diary-brain-checkpoint";
  if (body.type === "brain-vector-sync") return "brain-vector-sync";
  if (body.type === "profile-summary-generation") return "profile-summary-generation";
  if (body.type === "weekly-reflection-generation") return "weekly-reflection-generation";
  if (body.type === "daily-prompt") return "daily-prompt";
  if (body.type === "photo-diary-deletion") return "photo-diary-deletion";
  if (body.type === "billing-event") return "billing";
  return "queue-dispatch";
}

async function processWebhookMessage(
  message: Message<WebhookQueueMessage>,
  db: D1.shared.Client,
  queue: string,
  workerConfig?: WorkerConfig,
  cf?: CloudflareBindings,
): Promise<void> {
  const startedAt = Date.now();
  const traceId = message.body.traceId ?? message.body.id ?? message.id;
  const messageCount = line.webhook
    .parseEvents(message.body.payload)
    .filter(({ type }) => type === "message").length;
  try {
    const result =
      message.body.source === "line"
        ? await processLineWebhook(
            message.body.payload,
            db,
            workerConfig ?? getWorkerConfig(),
            cf?.do.conversation,
            cf?.do.accountData,
            message.body.routing,
            traceId,
            cf,
            message.attempts >= WEBHOOK_QUEUE_MAX_ATTEMPTS,
          )
        : {
            outcome: "discarded" as const,
            stage: "source.dispatch",
            resultCode: "UNKNOWN_WEBHOOK_SOURCE",
          };

    message.ack();
    const durationMs = Date.now() - startedAt;
    const fields = {
      event: "queue.message.completed",
      service: "worker",
      environment: workerConfig?.environment ?? "unknown",
      component: "line-webhook",
      traceId,
      queue,
      queueMessageId: message.id,
      messageType: "line-webhook",
      attempt: message.attempts,
      outcome: result.outcome,
      disposition: "ack" as const,
      stage: result.stage,
      ...(result.resultCode ? { resultCode: result.resultCode } : {}),
      messageCount,
      durationMs,
    };
    const description = describeQueueMessageResult({
      flow: "line-webhook",
      outcome: result.outcome,
      disposition: "ack",
      stage: result.stage,
      attempt: message.attempts,
      maxAttempts: WEBHOOK_QUEUE_MAX_ATTEMPTS,
      durationMs,
      resultCode: result.resultCode,
    });
    if (operationalLogLevel(result.outcome) === "info") {
      logger.info(fields, description);
    } else {
      logger.warn(fields, description);
    }
  } catch (error) {
    const safeError = toSafeOperationalErrorFields(error, {
      code: "UNEXPECTED_WEBHOOK_PROCESSING_ERROR",
      category: "unknown",
      stage: "webhook.process",
      retryable: true,
    });
    const disposition = safeError.retryable
      ? message.attempts >= WEBHOOK_QUEUE_MAX_ATTEMPTS
        ? "dead-letter"
        : "retry"
      : "ack";
    if (safeError.retryable) {
      message.retry({
        delaySeconds:
          WEBHOOK_RETRY_DELAYS_SECONDS[
            Math.min(message.attempts - 1, WEBHOOK_RETRY_DELAYS_SECONDS.length - 1)
          ] ?? 1_800,
      });
    } else message.ack();
    const durationMs = Date.now() - startedAt;
    logger.error(
      {
        event: "queue.message.failed",
        service: "worker",
        environment: workerConfig?.environment ?? "unknown",
        component: "line-webhook",
        traceId,
        queue,
        queueMessageId: message.id,
        messageType: "line-webhook",
        attempt: message.attempts,
        outcome: "failed",
        disposition,
        ...safeError,
        messageCount,
        durationMs,
      },
      describeQueueMessageResult({
        flow: "line-webhook",
        outcome: "failed",
        disposition,
        stage: safeError.stage,
        attempt: message.attempts,
        maxAttempts: WEBHOOK_QUEUE_MAX_ATTEMPTS,
        durationMs,
        error: safeError,
      }),
    );
  }
}

export async function handleQueueBatch(
  batch: MessageBatch<
    | WebhookQueueMessage
    | ChatTurnQueueMessage
    | DiaryBrainCheckpointQueueMessage
    | BrainVectorSyncQueueMessage
    | ProfileSummaryGenerationQueueMessage
    | WeeklyReflectionGenerationQueueMessage
    | DailyPromptQueueMessage
    | BillingQueueMessage
    | PhotoDiaryDeletionQueueMessage
  >,
  db: D1.shared.Client,
  workerConfig?: WorkerConfig,
  cf?: CloudflareBindings,
): Promise<void> {
  logger.debug(
    {
      event: "queue.batch.started",
      service: "worker",
      queue: batch.queue,
      count: batch.messages.length,
    },
    `[Queue dispatch] received ${batch.messages.length} message(s) from ${batch.queue}`,
  );

  for (const message of batch.messages) {
    const startedAt = Date.now();
    try {
      if ("type" in message.body && message.body.type === "chat-turn") {
        if (!cf || !workerConfig) throw new Error("Chat turn bindings are not configured");
        await processChatTurnMessage(message as Message<ChatTurnQueueMessage>, cf, workerConfig);
      } else if ("type" in message.body && message.body.type === "diary-brain-checkpoint") {
        if (!cf || !workerConfig) throw new Error("Diary Brain bindings are not configured");
        await processDiaryBrainCheckpointMessage(
          message as Message<DiaryBrainCheckpointQueueMessage>,
          cf,
          workerConfig,
        );
      } else if ("type" in message.body && message.body.type === "brain-vector-sync") {
        if (!cf || !workerConfig) throw new Error("Brain vector bindings are not configured");
        await processBrainVectorSyncMessage(
          message as Message<BrainVectorSyncQueueMessage>,
          cf,
          workerConfig,
        );
      } else if ("type" in message.body && message.body.type === "profile-summary-generation") {
        if (!cf || !workerConfig) throw new Error("Profile Summary bindings are not configured");
        await processProfileSummaryGenerationMessage(
          message as Message<ProfileSummaryGenerationQueueMessage>,
          cf,
          workerConfig,
        );
      } else if ("type" in message.body && message.body.type === "weekly-reflection-generation") {
        if (!cf || !workerConfig) throw new Error("Weekly reflection bindings are not configured");
        await processWeeklyReflectionGenerationMessage(
          message as Message<WeeklyReflectionGenerationQueueMessage>,
          cf,
          workerConfig,
        );
      } else if ("type" in message.body && message.body.type === "daily-prompt") {
        if (!cf || !workerConfig) throw new Error("Daily prompt bindings are not configured");
        await processDailyPromptMessage(
          message as Message<DailyPromptQueueMessage>,
          cf,
          workerConfig,
        );
      } else if ("type" in message.body && message.body.type === "billing-event") {
        if (!workerConfig) throw new Error("Billing configuration is not configured");
        await processBillingMessage(
          message as Message<BillingQueueMessage>,
          db,
          workerConfig,
          cf?.do.accountData,
        );
      } else if ("type" in message.body && message.body.type === "photo-diary-deletion") {
        if (!cf) throw new Error("Photo diary bindings are not configured");
        await processPhotoDiaryDeletionMessage(
          message as Message<PhotoDiaryDeletionQueueMessage>,
          cf,
        );
      } else {
        await processWebhookMessage(
          message as Message<WebhookQueueMessage>,
          db,
          batch.queue,
          workerConfig,
          cf,
        );
      }
    } catch (err) {
      // errをそのまま載せると、SDKの例外が抱えるrequest/response bodyから
      // 日記本文やContext Packageがlogへ流出しうる。識別できる情報だけを残す。
      const safeError = toSafeOperationalErrorFields(err, {
        code: "UNEXPECTED_QUEUE_MESSAGE_ERROR",
        category: "unknown",
        stage: "queue.dispatch",
        retryable: true,
      });
      const flow = flowOf(message.body);
      const durationMs = Date.now() - startedAt;
      logger.error(
        {
          event: "queue.message.failed",
          service: "worker",
          environment: workerConfig?.environment ?? "unknown",
          component: flow,
          traceId: "traceId" in message.body ? (message.body.traceId ?? message.id) : message.id,
          ...("traceIds" in message.body && message.body.traceIds?.length
            ? { traceIds: message.body.traceIds }
            : {}),
          queue: batch.queue,
          queueMessageId: message.id,
          attempt: message.attempts,
          outcome: "failed",
          disposition: "platform-retry",
          ...safeError,
          durationMs,
        },
        describeQueueMessageResult({
          flow,
          outcome: "failed",
          disposition: "platform-retry",
          stage: safeError.stage,
          attempt: message.attempts,
          maxAttempts: MAX_ATTEMPTS_BY_FLOW[flow],
          durationMs,
          error: safeError,
        }),
      );
      throw err;
    }
  }
}
