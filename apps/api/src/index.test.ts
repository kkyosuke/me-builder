import { describe, expect, it } from "vitest";
import { app } from "./index";

describe("API Server", () => {
  it("GET /api/health returns 200 and status ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("GET / returns 200 text response", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("me-builder API Server");
  });
});
