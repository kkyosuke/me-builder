import { describeHttpResult, logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config, getMcpConfig } from "./config";

const app = new Hono<{ Bindings: { ENVIRONMENT?: string; BASE_DOMAIN?: string } }>();

app.use("*", cors());

// グローバルエラーハンドラー (未捕捉例外を logger.error で出力)
app.onError((err, c) => {
  // errをそのまま載せると、SDK例外が抱えるrequest/response bodyがlogへ流出しうる。
  logger.error(
    {
      event: "http.request.failed",
      service: "mcp",
      method: c.req.method,
      path: c.req.path,
      status: 500,
      outcome: "failed",
      ...toSafeOperationalErrorFields(err, {
        code: "UNEXPECTED_MCP_ERROR",
        category: "unknown",
        stage: "http.handle",
        retryable: false,
      }),
    },
    `[MCP] ${c.req.method} ${c.req.path} -> 500 (unhandled exception)`,
  );
  return c.json({ error: "Internal Server Error" }, 500);
});

// HTTP リクエストログミドルウェア (構造化 JSON ログ)
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const responseTimeMs = Date.now() - start;
  logger.info(
    {
      event: "http.request.completed",
      service: "mcp",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      responseTimeMs,
    },
    describeHttpResult({
      service: "MCP",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: responseTimeMs,
    }),
  );
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

export { app };
export default {
  port: config.port,
  fetch: app.fetch,
};
