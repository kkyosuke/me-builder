import type {
  ChatTurnQueueMessage,
  DiaryBrainCheckpointQueueMessage,
  MessageBatch,
  WebhookQueueMessage,
} from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import { toSafeOperationalErrorFields } from "@me-builder/shared";
import { getCloudflareBindings, getWorkerConfig } from "../config";
import { handleQueueBatch } from "../logic/webhook";
import type { Env } from "../types";

export async function queueHandler(
  batch: MessageBatch<
    WebhookQueueMessage | ChatTurnQueueMessage | DiaryBrainCheckpointQueueMessage
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
      "Queue batch configuration failed",
    );
    throw error;
  }
  await handleQueueBatch(batch, cf.d1, workerConfig, cf);
}
