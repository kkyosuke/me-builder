import type { SafeOperationalErrorFields } from "@me-builder/shared";
import {
  describeHttpResult,
  httpOutcome,
  logger,
  operationalLogLevel,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config, getMcpConfig } from "./config";

const app = new Hono<{
  Bindings: { ENVIRONMENT?: string; BASE_DOMAIN?: string };
  Variables: { safeError?: SafeOperationalErrorFields };
}>();

app.use("*", cors());

// 例外の分類はここでしか作れないが、最終statusを知るのはmiddlewareなので、
// 記録はせずに安全な分類だけを預けて終端ログ1件へまとめる。
// errをそのまま載せると、SDK例外が抱えるrequest/response bodyがlogへ流出しうる。
app.onError((err, c) => {
  c.set(
    "safeError",
    toSafeOperationalErrorFields(err, {
      code: "UNEXPECTED_MCP_ERROR",
      category: "unknown",
      stage: "http.handle",
      retryable: false,
    }),
  );
  return c.json({ error: "Internal Server Error" }, 500);
});

// HTTP リクエストログミドルウェア (構造化 JSON ログ)
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const responseTimeMs = Date.now() - start;
  const status = c.res.status;
  const safeError = c.get("safeError");
  const outcome = httpOutcome(status);
  const fields = {
    event: outcome === "failed" ? "http.request.failed" : "http.request.completed",
    service: "mcp",
    method: c.req.method,
    path: c.req.path,
    status,
    outcome,
    responseTimeMs,
    ...(safeError ?? {}),
  };
  const description = describeHttpResult({
    service: "MCP",
    method: c.req.method,
    path: c.req.path,
    status,
    durationMs: responseTimeMs,
    ...(safeError ? { errorCode: safeError.errorCode } : {}),
  });
  const level = operationalLogLevel(outcome);
  if (level === "error") logger.error(fields, description);
  else if (level === "info") logger.info(fields, description);
  else logger.warn(fields, description);
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
