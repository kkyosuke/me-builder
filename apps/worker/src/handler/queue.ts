import type {
  BillingQueueMessage,
  BrainVectorSyncQueueMessage,
  ChatTurnQueueMessage,
  DailyPromptQueueMessage,
  DiaryBrainCheckpointQueueMessage,
  MessageBatch,
  PhotoDiaryDeletionQueueMessage,
  ProfileSummaryGenerationQueueMessage,
  WebhookQueueMessage,
  WeeklyReflectionGenerationQueueMessage,
} from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import { toSafeOperationalErrorFields } from "@me-builder/shared";
import { getCloudflareBindings, getWorkerConfig } from "../config";
import type { Env } from "../types";
import { handleQueueBatch } from "./queue-dispatch";

export async function queueHandler(
  batch: MessageBatch<
    | WebhookQueueMessage
    | BillingQueueMessage
    | ChatTurnQueueMessage
    | DailyPromptQueueMessage
    | DiaryBrainCheckpointQueueMessage
    | BrainVectorSyncQueueMessage
    | ProfileSummaryGenerationQueueMessage
    | WeeklyReflectionGenerationQueueMessage
    | PhotoDiaryDeletionQueueMessage
  >,
  env: Env,
): Promise<void> {
  let workerConfig: ReturnType<typeof getWorkerConfig>;
  let cf: ReturnType<typeof getCloudflareBindings>;
  try {
    workerConfig = getWorkerConfig(env as unknown as Record<string, unknown>);
    cf = getCloudflareBindings(env);
  } catch (error) {
    logger.error(
      {
        event: "queue.batch.failed",
        service: "worker",
        queue: batch.queue,
        outcome: "failed",
        disposition: "platform-retry",
        ...toSafeOperationalErrorFields(error, {
          code: "WORKER_CONFIGURATION_FAILED",
          category: "configuration",
          stage: "worker.configure",
          retryable: true,
        }),
      },
      `[Queue dispatch] failed at worker.configure -> platform-retry (queue ${batch.queue}, WORKER_CONFIGURATION_FAILED)`,
    );
    throw error;
  }
  await handleQueueBatch(batch, cf.d1, workerConfig, cf);
}
