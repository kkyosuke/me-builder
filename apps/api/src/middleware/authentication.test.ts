import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";
import type { AuthenticationResolver } from "./authentication";
import { authenticatedActor, createAuthenticationMiddleware } from "./authentication";

const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
};

describe("authentication middleware", () => {
  it("fake verifierのactorをContextへ設定し、同じrequestでは1回だけ解決する", async () => {
    const resolver: AuthenticationResolver = vi.fn().mockResolvedValue({
      type: "authenticated",
      actor,
      accountRole: "user",
    });
    const app = new Hono<AppEnv>();
    const middleware = createAuthenticationMiddleware(resolver);
    app.get("/", middleware, middleware, (c) => c.json(authenticatedActor(c)));

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...actor,
      authenticatedAt: "2026-08-16T00:00:00.000Z",
    });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["https://web.example", "csrf-token", 200],
    ["https://attacker.example", "csrf-token", 403],
    ["https://web.example", "wrong-token", 403],
  ] as const)("application session更新でOriginとCSRFを検証する", async (origin, csrf, status) => {
    const app = new Hono<AppEnv>();
    const put = vi.fn().mockResolvedValue(undefined);
    const now = new Date();
    const middleware = createAuthenticationMiddleware(async (c) => {
      c.set("authenticationSource", "application-session");
      c.set("applicationSessionToken", "session-token");
      return { type: "authenticated", actor, accountRole: "user" };
    });
    app.post("/", middleware, (c) => c.text("ok"));

    const response = await app.request(
      "/",
      { method: "POST", headers: { Origin: origin, "X-CSRF-Token": csrf } },
      {
        ENVIRONMENT: "test",
        WEB_ORIGIN: "https://web.example",
        DB: {} as never,
        SESSION_STORE: {
          get: async () => ({
            accountId: "account-1",
            authenticationMethod: "liff",
            authenticatedAt: now.toISOString(),
            issuedAt: now.toISOString(),
            lastSeenAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 60_000).toISOString(),
            sessionVersion: 1,
            csrfToken: "csrf-token",
            authenticatedIdentityId: "identity-1",
          }),
          put,
        } as never,
      },
    );

    expect(response.status).toBe(status);
    expect(put).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });

  it.each([
    ["credential_missing", 401],
    ["credential_invalid", 401],
    ["authentication_not_configured", 503],
  ] as const)("%sを共通HTTP結果へ変換する", async (reason, status) => {
    const app = new Hono<AppEnv>();
    app.get(
      "/",
      createAuthenticationMiddleware(async () => ({ type: "unauthenticated", reason })),
      (c) => c.text("unreachable"),
    );

    const response = await app.request("/");

    expect(response.status).toBe(status);
  });
});
