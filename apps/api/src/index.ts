import { Hono } from "hono";
import { cors } from "hono/cors";
import { config, getConfig } from "./config";
import { registerLineWebhook } from "./lib/line-webhook";

const app = new Hono<{
  Bindings: {
    ENVIRONMENT?: string;
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_WEBHOOK_URL?: string;
    BASE_URL?: string;
  };
}>();

// CORS を有効化
app.use("*", cors());

// ヘルスチェックエンドポイント
app.get("/api/health", (c) => {
  const currentConfig = getConfig(c.env);
  return c.json({
    status: "ok",
    environment: currentConfig.environment,
    timestamp: new Date().toISOString(),
  });
});

// LINE Webhook 受信エンドポイント
app.post("/api/line/webhook", async (c) => {
  return c.json({ status: "ok" });
});

// ルート
app.get("/", (c) => {
  return c.text("me-builder API Server running!");
});

// 起動時の LINE Webhook 自動登録処理
if (typeof process !== "undefined" && process.env) {
  registerLineWebhook();
}

console.log(`API Server is running on http://localhost:${config.port}`);

export { app };
export default {
  port: config.port,
  fetch: app.fetch,
};
