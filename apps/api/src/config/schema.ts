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
  /** LIFF ID。未設定の場合、LINE Login チャネル ID の補完元がなくなります。 */
  liffId: v.optional(v.string()),
  /** LINE Login チャネル ID。ID トークンの `aud` の期待値として使います。 */
  lineLoginChannelId: v.optional(v.string()),
  /** カンマ区切りの設定値を解析した、管理者として扱うLINE user ID。 */
  adminLineUserIds: v.optional(v.array(v.string()), []),
  webhookQueueName: v.optional(v.string()),
  webhookQueue: v.optional(
    v.custom<Queue<WebhookQueueMessage>>(
      (val) => val === undefined || (typeof val === "object" && val !== null && "send" in val),
    ),
  ),
});

export type ApiConfig = v.InferOutput<typeof ConfigSchema>;
