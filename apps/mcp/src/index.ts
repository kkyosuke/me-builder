import { logger } from "@me-builder/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config, getMcpConfig } from "./config";

const app = new Hono<{ Bindings: { ENVIRONMENT?: string; BASE_DOMAIN?: string } }>();

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

// MCP サーバーヘルスチェック
app.get("/health", (c) => {
  const currentConfig = getMcpConfig(c.env);
  return c.json({
    service: "me-builder MCP Server",
    status: "ok",
    environment: currentConfig.environment,
    timestamp: new Date().toISOString(),
  });
});

// MCP SSE / HTTP プロトコル用スケルトンエンドポイント
app.get("/sse", (c) => {
  return c.text("MCP SSE endpoint skeleton");
});

app.post("/messages", (c) => {
  return c.json({ message: "MCP Message endpoint skeleton" });
});

logger.info(`MCP Server is running on http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
