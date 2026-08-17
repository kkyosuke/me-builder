import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";
import { createCurrentTermsPolicyMiddleware } from "./authorization";

function appWithAcceptance(accepted: boolean) {
  const checker = vi.fn().mockResolvedValue(accepted);
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("authenticatedActor", {
      accountId: "account-1",
      authenticationMethod: "liff",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
    });
    await next();
  });
  app.get("/", createCurrentTermsPolicyMiddleware(checker), (c) => c.text("ok"));
  return { app, checker };
}

describe("current terms policy", () => {
  it("同意済みactorだけを後続へ通す", async () => {
    const { app, checker } = appWithAcceptance(true);
    const response = await app.request("/", undefined, { DB: {} as never });
    expect(response.status).toBe(200);
    expect(checker).toHaveBeenCalledWith(expect.anything(), "account-1");
  });

  it("未同意を未認証とは区別して428にする", async () => {
    const { app } = appWithAcceptance(false);
    const response = await app.request("/", undefined, { DB: {} as never });
    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({
      error: "Terms acceptance required",
      reason: "terms_not_accepted",
    });
  });

  it("D1設定不足を503にする", async () => {
    const { app, checker } = appWithAcceptance(true);
    const response = await app.request("/");
    expect(response.status).toBe(503);
    expect(checker).not.toHaveBeenCalled();
  });
});
