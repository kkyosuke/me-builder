import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

// CORS を有効化
app.use("*", cors());

// ヘルスチェックエンドポイント
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

// ルート
app.get("/", (c) => {
  return c.text("me-builder API Server running on Bun!");
});

const port = Number(process.env.PORT) || 3000;

console.log(`API Server is running on http://localhost:${port}`);

export { app };
export default {
  port,
  fetch: app.fetch,
};
