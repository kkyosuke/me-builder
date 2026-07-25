import {
  type Message,
  type MessageBatch,
  type WebhookQueueMessage,
  logger,
} from "@me-builder/shared";
import { getWorkerConfig } from "./config";

export interface Env {
  ENVIRONMENT?: string;
  BASE_DOMAIN?: string;
  BASE_URL?: string;
  API_URL?: string;
}

export async function processWebhookMessage(message: Message<WebhookQueueMessage>): Promise<void> {
  logger.info(
    {
      id: message.id,
      timestamp: message.timestamp,
      event: message.body,
    },
    "Processing webhook message from queue",
  );
  message.ack();
}

export async function handleQueueBatch(batch: MessageBatch<WebhookQueueMessage>): Promise<void> {
  logger.info(
    {
      queue: batch.queue,
      count: batch.messages.length,
    },
    "Received batch from queue",
  );

  for (const message of batch.messages) {
    await processWebhookMessage(message);
  }
}

export default {
  async queue(batch: MessageBatch<WebhookQueueMessage>, env: Env): Promise<void> {
    const workerConfig = getWorkerConfig(env as Record<string, unknown>);
    logger.info({ environment: workerConfig.environment }, "Worker queue handler triggered");
    await handleQueueBatch(batch);
  },
  async fetch(_req: Request, env: Env): Promise<Response> {
    const workerConfig = getWorkerConfig(env as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        status: "ok",
        service: "me-builder-worker",
        environment: workerConfig.environment,
        baseUrl: workerConfig.baseUrl,
        apiUrl: workerConfig.apiUrl,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
};
