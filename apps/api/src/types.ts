import type { D1Database } from "@cloudflare/workers-types";
import type { Queue, WebhookQueueMessage } from "@me-builder/shared";

/**
 * Cloudflare Workers のバインディングと環境変数。
 *
 * `interface` ではなく型エイリアスにしています。`interface` は暗黙のインデックスシグネチャを
 * 持たないため、`getConfig(env?: Record<string, unknown>)` へそのまま渡せません。
 */
type Env = {
  ENVIRONMENT?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_WEBHOOK_URL?: string;
  LIFF_ID?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  BASE_URL?: string;
  WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;
  DB?: D1Database;
};

/** Hono の型引数に渡すバインディング定義。 */
export type AppEnv = { Bindings: Env };
