import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutSession,
  createCustomerPortalSession,
  fetchBillingPlanCatalog,
  fetchBillingTrialEligibility,
  verifyCheckoutSessionCompletion,
} from "./billing-api";

describe("createCustomerPortalSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("本人のID tokenだけを送り、短命URLを返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "https://billing.stripe.test/session" }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(createCustomerPortalSession("https://api.example.test", "id-token")).resolves.toBe(
      "https://billing.stripe.test/session",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/billing/portal-sessions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer id-token" },
      }),
    );
  });

  it("Customer対応がない利用者へ反映待ちを案内する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
    await expect(createCustomerPortalSession(undefined, "id-token")).rejects.toThrow(
      "管理できる契約がまだありません",
    );
  });
});

describe("billing purchase api", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("公開Plan catalogを検証して返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            plans: [
              {
                code: "lite",
                name: "Lite",
                description: "description",
                highlights: ["AI返信 月150回"],
                trialDays: null,
                prices: [
                  { interval: "month", amount: 780, currency: "JPY" },
                  { interval: "year", amount: 7_800, currency: "JPY" },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchBillingPlanCatalog("https://api.example.test")).resolves.toMatchObject([
      { code: "lite", prices: [{ amount: 780 }, { amount: 7_800 }] },
    ]);
  });

  it("本人のAccount単位のtrial利用可否を返す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ eligible: true, trialDays: 14 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchBillingTrialEligibility("https://api.example.test", "id-token"),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/billing/trial-eligibility",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("本人のtokenとPlan選択だけをCheckout APIへ送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.test/session" }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createCheckoutSession("https://api.example.test", "id-token", {
        plan: "full",
        interval: "year",
      }),
    ).resolves.toBe("https://checkout.stripe.test/session");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/billing/checkout-sessions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer id-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan: "full", interval: "year" }),
      }),
    );
  });

  it("既存契約の二重購入を画面用エラーへ変換する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Billing session unavailable",
            reason: "existing_subscription",
          }),
          { status: 409 },
        ),
      ),
    );

    await expect(
      createCheckoutSession(undefined, "id-token", { plan: "lite", interval: "month" }),
    ).rejects.toThrow("現在の契約があります");
  });

  it("本人のCheckout Sessionがcompleteの場合だけ復帰を受理する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "complete" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyCheckoutSessionCompletion("https://api.example.test", "id-token", "cs_test_completed"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/billing/checkout-sessions/cs_test_completed",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("未完了Checkout Sessionを購入完了として扱わない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "open" }), { status: 200 })),
    );
    await expect(
      verifyCheckoutSessionCompletion(undefined, "id-token", "cs_test_open"),
    ).rejects.toThrow("購入手続きが完了していません");
  });
});
