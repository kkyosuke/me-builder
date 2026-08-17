import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";
import type { AuthenticationResolver } from "./authentication";
import { authenticatedActor, createAuthenticationMiddleware } from "./authentication";

describe("authentication middleware", () => {
  it("fake verifierのactorをContextへ設定し、同じrequestでは1回だけ解決する", async () => {
    const actor = {
      accountId: "account-1",
      authenticationMethod: "liff" as const,
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
    };
    const resolver: AuthenticationResolver = vi.fn().mockResolvedValue({
      type: "authenticated",
      actor,
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
