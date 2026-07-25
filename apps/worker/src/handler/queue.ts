import type { MessageBatch, WebhookQueueMessage } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import { d1 } from "@me-builder/lib";
import { getWorkerConfig } from "../config";
import { handleQueueBatch } from "../logic/webhook";
import type { Env } from "../types";

export async function queueHandler(batch: MessageBatch<WebhookQueueMessage>, env: Env): Promise<void> {
  try {
    const workerConfig = getWorkerConfig(env as unknown as Record<string, unknown>);
    const db = d1.client.create(env.DB);
    logger.info({ environment: workerConfig.environment }, "Worker queue handler triggered");
    await handleQueueBatch(batch, db, workerConfig);
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
