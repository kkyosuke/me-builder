import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono<{ Bindings: { ENVIRONMENT?: string } }>();

// CORS を有効化
app.use("*", cors());

// ヘルスチェックエンドポイント
app.get("/api/health", (c) => {
  const env =
    c.env?.ENVIRONMENT ||
    (typeof process !== "undefined" ? process.env.NODE_ENV : undefined) ||
    "development";
  return c.json({
    status: "ok",
    environment: env,
    timestamp: new Date().toISOString(),
  });
});

// ルート
app.get("/", (c) => {
  return c.text("me-builder API Server running!");
});

const port = Number(typeof process !== "undefined" ? process.env?.PORT : 3000) || 3000;

console.log(`API Server is running on http://localhost:${port}`);

export { app };
export default {
  port,
  fetch: app.fetch,
};
