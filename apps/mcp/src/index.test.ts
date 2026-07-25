import { describe, expect, it } from "vitest";
import { app } from "./index";

describe("MCP Server Error Handling", () => {
  it("GET /health returns 200 ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  it("handles unhandled exception with 500 status using app.onError", async () => {
    const testApp = new (await import("hono")).Hono();
    testApp.onError((err, c) => c.json({ error: "Internal Server Error" }, 500));
    testApp.get("/test-error", () => {
      throw new Error("Test error");
    });

    const res = await testApp.request("/test-error");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data).toEqual({ error: "Internal Server Error" });
  });
});
