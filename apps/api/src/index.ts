import { line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config, getConfig } from "./config";
import { postLiffSession, postLineWebhook } from "./controller/line";
import { getSurveys } from "./controller/survey";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

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
app.post("/api/line/webhook", postLineWebhook);

// LIFF の ID トークンを検証し、対応する Account を解決するエンドポイント。
//
// 受け付けるのは ID トークンだけ。クライアントから送られてきた userId は
// サーバー側で検証できないため識別子として使わない (なりすましを防ぐ)。
app.post("/api/line/liff/session", postLiffSession);

// LIFF ID トークンで本人確認し、Accountごとの回答進捗を含むアンケート一覧を返す。
app.get("/api/surveys", getSurveys);

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
