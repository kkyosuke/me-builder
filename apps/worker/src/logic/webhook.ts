import { line } from "@me-builder/lib";
import type { d1 } from "@me-builder/lib";
import {
  type ChatTurnQueueMessage,
  type Message,
  type MessageBatch,
  type WebhookQueueMessage,
  logger,
} from "@me-builder/shared";
import { type CloudflareBindings, type WorkerConfig, getWorkerConfig } from "../config";
import { processChatTurnMessage } from "../handler/chat-turn";
import { processLineWebhook } from "./feature/line";

async function processWebhookMessage(
  message: Message<WebhookQueueMessage>,
  db: d1.Client,
  workerConfig?: WorkerConfig,
  cf?: CloudflareBindings,
): Promise<void> {
  const messageCount = line.webhook.extractMessages(message.body.payload).length;
  logger.info(
    {
      id: message.id,
      timestamp: message.timestamp,
      source: message.body.source,
      receivedAt: message.body.receivedAt,
      messageCount,
    },
    "Processing webhook message from queue",
  );

  switch (message.body.source) {
    case "line":
      await processLineWebhook(
        message.body.payload,
        db,
        workerConfig ?? getWorkerConfig(),
        cf?.do.conversation,
      );
      break;
    default:
      logger.warn({ source: message.body.source }, "Unknown webhook source");
      break;
  }

  message.ack();
}

export async function handleQueueBatch(
  batch: MessageBatch<WebhookQueueMessage | ChatTurnQueueMessage>,
  db: d1.Client,
  workerConfig?: WorkerConfig,
  cf?: CloudflareBindings,
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
      if ("type" in message.body && message.body.type === "chat-turn") {
        if (!cf || !workerConfig) throw new Error("Chat turn bindings are not configured");
        await processChatTurnMessage(message as Message<ChatTurnQueueMessage>, cf, workerConfig);
      } else {
        await processWebhookMessage(message as Message<WebhookQueueMessage>, db, workerConfig, cf);
      }
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
