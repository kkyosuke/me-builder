import type { Message, MessageBatch, Queue } from "@cloudflare/workers-types";

export interface WebhookQueueMessage {
  id: string;
  source: string;
  receivedAt: string;
  payload: unknown;
}

export type { Queue, Message, MessageBatch };
