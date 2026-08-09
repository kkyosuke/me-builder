import { line } from "@me-builder/lib";
import type { d1 } from "@me-builder/lib";
import {
  type AvatarQueueMessage,
  type ChatTurnQueueMessage,
  type DiaryBrainCheckpointQueueMessage,
  type Message,
  type MessageBatch,
  type WebhookQueueMessage,
  logger,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import { type CloudflareBindings, type WorkerConfig, getWorkerConfig } from "../config";
import { processAvatarMessage } from "../handler/avatar";
import { processChatTurnMessage } from "../handler/chat-turn";
import { processDiaryBrainCheckpointMessage } from "../handler/diary-brain-checkpoint";
import { processLineWebhook } from "./feature/line";

/** max_retries = 3では初回と3回の再試行を合わせて4 attemptsになる。 */
const WEBHOOK_QUEUE_MAX_ATTEMPTS = 4;

async function processWebhookMessage(
  message: Message<WebhookQueueMessage>,
  db: d1.Client,
  queue: string,
  workerConfig?: WorkerConfig,
  cf?: CloudflareBindings,
): Promise<void> {
  const startedAt = Date.now();
  const traceId = message.body.traceId ?? message.body.id ?? message.id;
  const messageCount = line.webhook.extractMessages(message.body.payload).length;
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
          )
        : {
            outcome: "discarded" as const,
            stage: "source.dispatch",
            resultCode: "UNKNOWN_WEBHOOK_SOURCE",
          };

    message.ack();
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
      disposition: "ack",
      stage: result.stage,
      ...(result.resultCode ? { resultCode: result.resultCode } : {}),
      messageCount,
      durationMs: Date.now() - startedAt,
    };
    if (result.outcome === "succeeded") {
      logger.info(fields, "Webhook queue message completed");
    } else {
      logger.warn(fields, "Webhook queue message completed with a non-success outcome");
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
    if (safeError.retryable) message.retry();
    else message.ack();
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
        durationMs: Date.now() - startedAt,
      },
      "Webhook queue message failed",
    );
  }
}

export async function handleQueueBatch(
  batch: MessageBatch<
    | WebhookQueueMessage
    | ChatTurnQueueMessage
    | DiaryBrainCheckpointQueueMessage
    | AvatarQueueMessage
  >,
  db: d1.Client,
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
    "Received batch from queue",
  );

  for (const message of batch.messages) {
    try {
      if ("type" in message.body && message.body.type === "avatar") {
        if (!cf || !workerConfig) throw new Error("Avatar bindings are not configured");
        await processAvatarMessage(message as Message<AvatarQueueMessage>, cf, workerConfig);
      } else if ("type" in message.body && message.body.type === "chat-turn") {
        if (!cf || !workerConfig) throw new Error("Chat turn bindings are not configured");
        await processChatTurnMessage(message as Message<ChatTurnQueueMessage>, cf, workerConfig);
      } else if ("type" in message.body && message.body.type === "diary-brain-checkpoint") {
        if (!cf || !workerConfig) throw new Error("Diary Brain bindings are not configured");
        await processDiaryBrainCheckpointMessage(
          message as Message<DiaryBrainCheckpointQueueMessage>,
          cf,
          workerConfig,
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
      logger.error(
        {
          event: "queue.message.failed",
          service: "worker",
          environment: workerConfig?.environment ?? "unknown",
          traceId: "traceId" in message.body ? (message.body.traceId ?? message.id) : message.id,
          ...("traceIds" in message.body && message.body.traceIds?.length
            ? { traceIds: message.body.traceIds }
            : {}),
          queue: batch.queue,
          queueMessageId: message.id,
          attempt: message.attempts,
          outcome: "failed",
          disposition: "platform-retry",
          ...toSafeOperationalErrorFields(err, {
            code: "UNEXPECTED_QUEUE_MESSAGE_ERROR",
            category: "unknown",
            stage: "queue.dispatch",
            retryable: true,
          }),
        },
        "Queue message failed",
      );
      throw err;
    }
  }
}
