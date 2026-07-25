import { line } from "@me-builder/lib";
import {
  type Message,
  type MessageBatch,
  type WebhookQueueMessage,
  logger,
} from "@me-builder/shared";
import type { d1 } from "@me-builder/lib";
import type { WorkerConfig } from "../config";
import { processLineWebhook } from "./feature/line";

async function processWebhookMessage(
  message: Message<WebhookQueueMessage>,
  db: d1.Client,
  workerConfig?: WorkerConfig,
): Promise<void> {
  const messages = line.webhook.extractMessages(message.body.payload);
  logger.info(
    {
      id: message.id,
      timestamp: message.timestamp,
      event: message.body,
      messages: messages.length > 0 ? messages : undefined,
    },
    "Processing webhook message from queue",
  );

  switch (message.body.source) {
    case "line":
      await processLineWebhook(message.body.payload, db, workerConfig);
      break;
    default:
      logger.warn({ source: message.body.source }, "Unknown webhook source");
      break;
  }

  message.ack();
}

export async function handleQueueBatch(
  batch: MessageBatch<WebhookQueueMessage>,
  db: d1.Client,
  workerConfig?: WorkerConfig,
): Promise<void> {
  logger.info(
    {
      queue: batch.queue,
      count: batch.messages.length,
    },
    "Received batch from queue",
  );

  for (const message of batch.messages) {
    try {
      await processWebhookMessage(message, db, workerConfig);
    } catch (err) {
      logger.error(
        {
          err,
          messageId: message.id,
        },
        "Error processing webhook message in worker",
      );
      throw err;
    }
  }
}
