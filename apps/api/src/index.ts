import { line } from "@me-builder/lib";
import { type Queue, type WebhookQueueMessage, logger } from "@me-builder/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config, getConfig } from "./config";

const app = new Hono<{
  Bindings: {
    ENVIRONMENT?: string;
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_WEBHOOK_URL?: string;
    BASE_URL?: string;
    WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;
  };
}>();

// CORS を有効化
app.use("*", cors());

// HTTP リクエストログミドルウェア (構造化 JSON ログ)
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    responseTimeMs: ms,
  });
});

// ヘルスチェックエンドポイント
app.get("/api/health", (c) => {
  const currentConfig = getConfig(c.env);
  return c.json({
    status: "ok",
    environment: currentConfig.environment,
    timestamp: new Date().toISOString(),
  });
});

// LINE Webhook 受信エンドポイント（受け取ったら Queue へ投入）
app.post("/api/line/webhook", async (c) => {
  const currentConfig = getConfig(c.env);
  const body = await c.req.json().catch(() => ({}));
  const event: WebhookQueueMessage = {
    id: crypto.randomUUID(),
    source: "line",
    receivedAt: new Date().toISOString(),
    payload: body,
  };

  const messages = line.webhook.extractMessages(body);

  if (currentConfig.webhookQueue) {
    await currentConfig.webhookQueue.send(event);
    logger.info(
      {
        id: event.id,
        source: event.source,
        messages: messages.length > 0 ? messages : undefined,
      },
      "Webhook event queued to WEBHOOK_QUEUE",
    );
  } else {
    logger.warn(
      {
        id: event.id,
        source: event.source,
        messages: messages.length > 0 ? messages : undefined,
      },
      "WEBHOOK_QUEUE binding not configured, skipping queue push",
    );
  }

  return c.json({ status: "ok", queued: Boolean(currentConfig.webhookQueue), id: event.id });
});

// ルート
app.get("/", (c) => {
  return c.text("me-builder API Server running!");
});

// 起動時の LINE Webhook 自動登録処理
if (typeof process !== "undefined" && process.env) {
  line.webhook.register({
    channelAccessToken: config.lineChannelAccessToken,
    webhookUrl: config.lineWebhookUrl,
  });
}

logger.info(`API Server is running on http://localhost:${config.port}`);

export { app };
export default {
  port: config.port,
  fetch: app.fetch,
};
