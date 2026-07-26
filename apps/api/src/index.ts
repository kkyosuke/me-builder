import { line } from "@me-builder/lib";
import { type Queue, type WebhookQueueMessage, logger } from "@me-builder/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config, getConfig } from "./config";

const app = new Hono<{
  Bindings: {
    ENVIRONMENT?: string;
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_CHANNEL_SECRET?: string;
    LINE_WEBHOOK_URL?: string;
    BASE_URL?: string;
    WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;
  };
}>();

// CORS を有効化
app.use("*", cors());

// グローバルエラーハンドラー (未捕捉例外を logger.error で出力)
app.onError((err, c) => {
  logger.error(
    {
      err,
      method: c.req.method,
      path: c.req.path,
    },
    "Unhandled exception in API server",
  );
  return c.json({ error: "Internal Server Error" }, 500);
});

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

// LINE Webhook 受信エンドポイント（署名検証 → Queue へ投入）
app.post("/api/line/webhook", async (c) => {
  const currentConfig = getConfig(c.env);

  // 署名検証は必ず「生のリクエストボディ文字列」に対して行う。
  // c.req.json() の結果を再 stringify するとバイト列が変わり検証が壊れるため、
  // まず text() で取得し、検証を通過してから JSON.parse する。
  const rawBody = await c.req.text();
  const signature = c.req.header("x-line-signature");

  if (currentConfig.lineChannelSecret) {
    const isValidSignature = line.webhook.verifySignature({
      body: rawBody,
      channelSecret: currentConfig.lineChannelSecret,
      signature,
    });

    if (!isValidSignature) {
      // 署名値・チャネルシークレットそのものはログに残さない
      logger.warn(
        {
          path: c.req.path,
          hasSignatureHeader: Boolean(signature),
          bodyLength: rawBody.length,
        },
        "Rejected LINE webhook request with missing or invalid x-line-signature",
      );
      return c.json({ error: "Unauthorized" }, 401);
    }
  } else if (currentConfig.environment === "production") {
    // 本番環境では署名検証をスキップせず、必ず拒否する
    logger.error(
      { path: c.req.path, environment: currentConfig.environment },
      "LINE_CHANNEL_SECRET is not configured in production, rejecting LINE webhook request",
    );
    return c.json({ error: "Unauthorized" }, 401);
  } else {
    logger.warn(
      { path: c.req.path, environment: currentConfig.environment },
      "LINE_CHANNEL_SECRET is not configured, skipping x-line-signature verification",
    );
  }

  let body: unknown = {};
  try {
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    logger.warn(
      { path: c.req.path, bodyLength: rawBody.length },
      "Received LINE webhook request with a non-JSON body",
    );
  }

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
