import { describe, expect, it } from "vitest";
import { app } from "../app";

describe("billing plan catalog", () => {
  it("認証なしで公開可能なPlan名と税込価格だけを返す", async () => {
    const response = await app.request("/api/billing/plans");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      plans: [
        { code: "lite", prices: [{ amount: 780 }, { amount: 7_800 }] },
        { code: "full", prices: [{ amount: 1_480 }, { amount: 14_800 }] },
        { code: "family", prices: [{ amount: 2_980 }, { amount: 29_800 }] },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/lookupKey|price_|productId/i);
  });

  it("未認証probeでは課金runtimeの設定有無を区別させない", async () => {
    const readyEnv = {
      DB: {},
      WEB_ORIGIN: "https://app.example.test",
      LINE_LOGIN_CHANNEL_ID: "1234567890",
      STRIPE_SECRET_KEY: "sk_test_preview",
      STRIPE_WEBHOOK_SECRET: "whsec_preview",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_management",
      STRIPE_PORTAL_PLAN_CHANGE_CONFIGURATION_ID: "bpc_standard",
      STRIPE_PORTAL_RESET_CONFIGURATION_ID: "bpc_reset",
      BILLING_QUEUE: { send: async () => undefined },
      SESSION_STORE: {
        get: async () => null,
        put: async () => undefined,
        delete: async () => undefined,
      },
    };
    const jsonRequest = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "lite", interval: "month" }),
    };

    expect(
      (await app.request("/api/billing/trial-eligibility", undefined, readyEnv as never)).status,
    ).toBe(401);
    expect(
      (await app.request("/api/billing/checkout-sessions", jsonRequest, readyEnv as never)).status,
    ).toBe(401);
    expect(
      (await app.request("/api/billing/plan-change-sessions", jsonRequest, readyEnv as never))
        .status,
    ).toBe(401);
    expect(
      (await app.request("/api/billing/portal-sessions", { method: "POST" }, readyEnv as never))
        .status,
    ).toBe(401);
    expect(
      (await app.request("/api/billing/webhook", { method: "POST", body: "{}" }, readyEnv as never))
        .status,
    ).toBe(400);

    expect(
      (
        await app.request("/api/billing/portal-sessions", { method: "POST" }, {
          ...readyEnv,
          STRIPE_PORTAL_CONFIGURATION_ID: undefined,
        } as never)
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/billing/plan-change-sessions", jsonRequest, {
          ...readyEnv,
          STRIPE_PORTAL_RESET_CONFIGURATION_ID: undefined,
        } as never)
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/billing/webhook", { method: "POST", body: "{}" }, {
          ...readyEnv,
          BILLING_QUEUE: undefined,
        } as never)
      ).status,
    ).toBe(503);
  });
});
