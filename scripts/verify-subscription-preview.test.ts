import { describe, expect, it, vi } from "vitest";
import { verifySubscriptionPreview } from "./verify-subscription-preview";

const plans = [
  {
    code: "lite",
    name: "Lite",
    description: "lite",
    highlights: [],
    trialDays: 14,
    prices: [
      { interval: "month", amount: 780, currency: "JPY" },
      { interval: "year", amount: 7_800, currency: "JPY" },
    ],
  },
  {
    code: "full",
    name: "Full",
    description: "full",
    highlights: [],
    trialDays: 14,
    prices: [
      { interval: "month", amount: 1_480, currency: "JPY" },
      { interval: "year", amount: 14_800, currency: "JPY" },
    ],
  },
  {
    code: "family",
    name: "ファミリーパック",
    description: "family",
    highlights: [],
    trialDays: 14,
    prices: [
      { interval: "month", amount: 2_980, currency: "JPY" },
      { interval: "year", amount: 29_800, currency: "JPY" },
    ],
  },
];

describe("verifySubscriptionPreview", () => {
  it("公開状態と認証Accountのprojectionを識別子なしで検証する", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(input.toString()).pathname;
      if (path === "/api/health") return Response.json({ status: "ok", environment: "preview" });
      if (path === "/api/billing/plans") return Response.json({ plans });
      if (path === "/api/billing/trial-eligibility") {
        return Response.json({ eligible: false, trialDays: 14 });
      }
      if (path === "/api/profile/entitlement") {
        return Response.json({ plan: "lite", status: "active", source: "subscription" });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    await expect(
      verifySubscriptionPreview({
        apiBaseUrl: "https://api.stg.example.test/path",
        idToken: "short-lived-token",
        expectedPlan: "lite",
        fetcher,
      }),
    ).resolves.toEqual({
      checks: [
        "api-health",
        "public-plan-catalog",
        "account-trial-eligibility",
        "account-plan-projection",
      ],
      plan: "lite",
      trialEligible: false,
    });
    expect(JSON.stringify(fetcher.mock.calls)).toContain("Bearer short-lived-token");
  });

  it("期待Planへ収束していなければ失敗する", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(input.toString()).pathname;
      if (path === "/api/health") return Response.json({ status: "ok", environment: "preview" });
      if (path === "/api/billing/plans") return Response.json({ plans });
      if (path === "/api/billing/trial-eligibility") {
        return Response.json({ eligible: true, trialDays: 14 });
      }
      return Response.json({ plan: "free", status: "free", source: "free" });
    }) as typeof fetch;

    await expect(
      verifySubscriptionPreview({
        apiBaseUrl: "https://api.stg.example.test",
        idToken: "token",
        expectedPlan: "full",
        fetcher,
        projectionAttempts: 2,
        projectionPollIntervalMs: 0,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("expected plan full");
  });

  it("webhook projectionが期待Planへ収束するまでbounded pollingする", async () => {
    let entitlementReads = 0;
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(input.toString()).pathname;
      if (path === "/api/health") return Response.json({ status: "ok", environment: "preview" });
      if (path === "/api/billing/plans") return Response.json({ plans });
      if (path === "/api/billing/trial-eligibility") {
        return Response.json({ eligible: false, trialDays: 14 });
      }
      entitlementReads += 1;
      return entitlementReads === 1
        ? Response.json({ plan: "free", status: "free", source: "free" })
        : Response.json({ plan: "full", status: "active", source: "subscription" });
    }) as typeof fetch;

    await expect(
      verifySubscriptionPreview({
        apiBaseUrl: "https://api.stg.example.test",
        idToken: "token",
        expectedPlan: "full",
        fetcher,
        projectionAttempts: 3,
        projectionPollIntervalMs: 0,
        sleep: async () => undefined,
      }),
    ).resolves.toMatchObject({ plan: "full" });
    expect(entitlementReads).toBe(2);
  });

  it("Planだけ一致してもsourceとstatusが課金projectionでなければ失敗する", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(input.toString()).pathname;
      if (path === "/api/health") return Response.json({ status: "ok", environment: "preview" });
      if (path === "/api/billing/plans") return Response.json({ plans });
      if (path === "/api/billing/trial-eligibility") {
        return Response.json({ eligible: false, trialDays: 14 });
      }
      return Response.json({ plan: "lite", status: "free", source: "free" });
    }) as typeof fetch;

    await expect(
      verifySubscriptionPreview({
        apiBaseUrl: "https://api.stg.example.test",
        idToken: "token",
        expectedPlan: "lite",
        fetcher,
      }),
    ).rejects.toThrow("entitlement response is invalid");
  });
});
