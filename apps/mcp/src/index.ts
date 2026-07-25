import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

app.use("*", cors());

// MCP サーバーヘルスチェック
app.get("/health", (c) => {
  return c.json({
    service: "me-builder MCP Server",
    status: "ok",
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

const port = Number(process.env.MCP_PORT) || 3001;

console.log(`MCP Server is running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
