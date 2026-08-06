import type { ChatTurnQueueMessage, MessageBatch, WebhookQueueMessage } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import { getCloudflareBindings, getWorkerConfig } from "../config";
import { handleQueueBatch } from "../logic/webhook";
import type { Env } from "../types";

export async function queueHandler(
  batch: MessageBatch<WebhookQueueMessage | ChatTurnQueueMessage>,
  env: Env,
): Promise<void> {
  try {
    const workerConfig = getWorkerConfig(env as unknown as Record<string, unknown>);
    const cf = getCloudflareBindings(env);
    logger.info({ environment: workerConfig.environment }, "Worker queue handler triggered");
    await handleQueueBatch(batch, cf.d1, workerConfig, cf);
  } catch (err) {
    logger.error(
      {
        err,
        queue: batch.queue,
      },
      "Unhandled exception in worker queue handler",
    );
    throw err;
  }
}
