import { D1, billing } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context, Next } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";

const mocks = vi.hoisted(() => ({
  createCheckout: vi.fn(),
}));

vi.mock("../middleware/authentication", () => ({
  requireAuthentication: async (c: Context<AppEnv>, next: Next) => {
    c.set("authenticatedActor", {
      accountId: "account-1",
      authenticationMethod: "liff",
      authenticatedAt: new Date("2026-08-17T00:00:00Z"),
    });
    await next();
  },
  authenticatedActor: (c: Context<AppEnv>) => c.get("authenticatedActor"),
}));

vi.mock("../middleware/authorization", () => ({
  requireCurrentTerms: async (_c: Context<AppEnv>, next: Next) => next(),
  requireAdmin: async (_c: Context<AppEnv>, next: Next) => next(),
  requireDevelopmentEnvironment: async (_c: Context<AppEnv>, next: Next) => next(),
}));

vi.mock("../logic/billing-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../logic/billing-sessions")>();
  return { ...actual, createBillingCheckoutSession: mocks.createCheckout };
});

import { app } from "../index";

const request = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ plan: "lite", interval: "month" }),
};

function configuredEnv(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: "preview",
    DB: {},
    WEB_ORIGIN: "https://stg.kagami.example",
    STRIPE_SECRET_KEY: "sk_test_preview",
    ...overrides,
  };
}

function terminalErrors(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter(([fields]) =>
    fields && typeof fields === "object"
      ? (fields as Record<string, unknown>).event === "http.request.failed"
      : false,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.createCheckout.mockReset();
});

describe("billing session observability", () => {
  it("Stripe設定不足を固定原因コード付きでCloudflareログへ出す", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const response = await app.request(
      "/api/billing/checkout-sessions",
      request,
      configuredEnv({ STRIPE_SECRET_KEY: undefined }) as never,
    );

    expect(response.status).toBe(503);
    expect(terminalErrors(error)).toHaveLength(1);
    expect(terminalErrors(error)[0]?.[0]).toMatchObject({
      path: "/api/billing/checkout-sessions",
      status: 503,
      errorCode: "BILLING_STRIPE_NOT_CONFIGURED",
      errorCategory: "configuration",
      stage: "billing.configuration.validate",
    });
  });

  it("Stripe SDK例外を本文なしの依存先分類でCloudflareログへ出す", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vi.spyOn(D1.shared.client, "create").mockReturnValue({} as never);
    mocks.createCheckout.mockRejectedValue(
      new billing.BillingProviderError("authentication", false, 401, {
        cause: new Error("Stripe response body must not be logged"),
      }),
    );

    const response = await app.request(
      "/api/billing/checkout-sessions",
      request,
      configuredEnv() as never,
    );

    expect(response.status).toBe(500);
    const calls = terminalErrors(error);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({
      path: "/api/billing/checkout-sessions",
      status: 500,
      errorCode: "BILLING_PROVIDER_AUTHENTICATION",
      errorCategory: "dependency",
      stage: "billing.checkout.create",
      dependency: "stripe",
      dependencyStatus: 401,
    });
    expect(JSON.stringify(calls)).not.toContain("Stripe response body must not be logged");
  });

  it("公開Planに対応するStripe Price不足を設定エラーとして記録する", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vi.spyOn(D1.shared.client, "create").mockReturnValue({} as never);
    mocks.createCheckout.mockResolvedValue({ type: "unavailable", reason: "plan_unavailable" });

    const response = await app.request(
      "/api/billing/checkout-sessions",
      request,
      configuredEnv() as never,
    );

    expect(response.status).toBe(503);
    expect(terminalErrors(error)[0]?.[0]).toMatchObject({
      status: 503,
      errorCode: "BILLING_PLAN_NOT_CONFIGURED",
      errorCategory: "configuration",
      stage: "billing.configuration.validate",
    });
  });
});
