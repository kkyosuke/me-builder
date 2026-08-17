import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";
import { setApplicationSessionCookie } from "./authentication";

describe("application session cookie", () => {
  it("HttpOnly Secure SameSite=Laxのhost-only cookieとして発行する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    const app = new Hono<AppEnv>();
    app.get("/", (c) => {
      setApplicationSessionCookie(c, "opaque-session-token", new Date("2026-08-18T00:00:00Z"));
      return c.text("ok");
    });

    const response = await app.request("/");
    const cookie = response.headers.get("Set-Cookie") ?? "";

    expect(cookie).toContain("__Host-me_builder_session=opaque-session-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
    vi.useRealTimers();
  });
});
