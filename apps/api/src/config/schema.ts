import type { Queue, WebhookQueueMessage } from "@me-builder/shared";
import * as v from "valibot";

export const ConfigSchema = v.object({
  port: v.pipe(
    v.optional(v.string(), "3000"),
    v.transform((val) => Number(val) || 3000),
  ),
  environment: v.optional(v.string(), "development"),
  lineChannelAccessToken: v.optional(v.string()),
  lineChannelSecret: v.optional(v.string()),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  lineWebhookUrl: v.optional(v.string()),
  webhookQueueName: v.optional(v.string()),
  webhookQueue: v.optional(
    v.custom<Queue<WebhookQueueMessage>>(
      (val) => val === undefined || (typeof val === "object" && val !== null && "send" in val),
    ),
  ),
});

export type ApiConfig = v.InferOutput<typeof ConfigSchema>;
