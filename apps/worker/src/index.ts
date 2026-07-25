import { line } from "@me-builder/lib";
import {
  type Message,
  type MessageBatch,
  type WebhookQueueMessage,
  logger,
} from "@me-builder/shared";
import { type WorkerConfig, getWorkerConfig } from "./config";

export interface Env {
  ENVIRONMENT?: string;
  BASE_DOMAIN?: string;
  BASE_URL?: string;
  API_URL?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
}

export async function processWebhookMessage(
  message: Message<WebhookQueueMessage>,
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

  if (message.body.source === "line") {
    await line.webhook.handleEvent(message.body.payload, workerConfig?.lineChannelAccessToken);
  }

  message.ack();
}

export async function handleQueueBatch(
  batch: MessageBatch<WebhookQueueMessage>,
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
      await processWebhookMessage(message, workerConfig);
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

export default {
  async queue(batch: MessageBatch<WebhookQueueMessage>, env: Env): Promise<void> {
    try {
      const workerConfig = getWorkerConfig(env as Record<string, unknown>);
      logger.info({ environment: workerConfig.environment }, "Worker queue handler triggered");
      await handleQueueBatch(batch, workerConfig);
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
  },
  async fetch(_req: Request, env: Env): Promise<Response> {
    try {
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
    } catch (err) {
      logger.error({ err }, "Unhandled exception in worker fetch handler");
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
