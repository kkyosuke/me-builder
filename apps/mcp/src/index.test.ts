import { describe, expect, it } from "vitest";
import { app } from "./index";

describe("MCP public boundary", () => {
  it("feature flag無効時はPOST /mcpを501へ閉じる", async () => {
    const response = await app.request(
      "/mcp",
      { method: "POST" },
      { MCP_FEATURE_ENABLED: "false" },
    );
    expect(response.status).toBe(501);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "MCP_NOT_AVAILABLE" });
  });

  it("有効時の未認証requestはresource metadata付き401にする", async () => {
    const response = await app.request(
      "/mcp",
      { method: "POST" },
      {
        MCP_FEATURE_ENABLED: "true",
        BASE_URL: "https://mcp.example",
        API_URL: "https://api.example",
        DB: {} as never,
        ACCOUNT_DATA: {} as never,
        BRAIN_VECTOR_INDEX: {} as never,
        GOOGLE_VERTEX_AI_API_KEY: "gemini-secret",
        BRAIN_VECTOR_HMAC_SECRET: "brain-secret",
        MCP_TOKEN_HMAC_SECRET: "token-secret",
      },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "https://mcp.example/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("Protected Resource Metadataは固定resourceとscopeだけを広告する", async () => {
    const response = await app.request("/.well-known/oauth-protected-resource/mcp", undefined, {
      BASE_URL: "https://mcp.example",
      API_URL: "https://api.example",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: "https://mcp.example/mcp",
      authorization_servers: ["https://api.example"],
      scopes_supported: ["brain:search"],
    });
  });

  it("外部OriginからのMCP POSTは認証処理前に拒否する", async () => {
    const response = await app.request(
      "/mcp",
      { method: "POST", headers: { Origin: "https://evil.example" } },
      {
        MCP_FEATURE_ENABLED: "true",
        BASE_URL: "https://mcp.example",
        API_URL: "https://api.example",
      },
    );
    expect(response.status).toBe(403);
  });

  it("旧SSE endpointは有効化後も501のままにする", async () => {
    expect((await app.request("/sse")).status).toBe(501);
    expect((await app.request("/messages", { method: "POST" })).status).toBe(501);
  });
});
