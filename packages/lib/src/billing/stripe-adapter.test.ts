import { describe, expect, it, vi } from "vitest";
import { BillingProviderError } from "./provider";
import { StripeBillingProvider, classifyStripeError } from "./stripe-adapter";

describe("StripeBillingProvider", () => {
  it("Account削除時にStripe Customerを冪等key付きで削除する", async () => {
    const del = vi.fn().mockResolvedValue({ id: "cus_delete", deleted: true });
    const provider = new StripeBillingProvider({ customers: { del } } as never);

    await expect(provider.deleteCustomer("cus_delete", "account-delete:key")).resolves.toEqual({
      id: "cus_delete",
      deleted: true,
    });
    expect(del).toHaveBeenCalledWith("cus_delete", { idempotencyKey: "account-delete:key" });
  });

  it("creates checkout with selection metadata and maps the latest session", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cs_test_new",
      url: "https://checkout.stripe.test/new",
    });
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          id: "cs_test_open",
          customer: "cus_secret",
          status: "open",
          url: "https://checkout.stripe.test/open",
          metadata: { plan: "full", interval: "year" },
        },
      ],
    });
    const provider = new StripeBillingProvider({
      checkout: { sessions: { create, list } },
    } as never);

    await provider.createCheckoutSession(
      {
        customerId: "cus_secret",
        priceId: "price_full_year",
        successUrl: "https://example.test/success",
        cancelUrl: "https://example.test/cancel",
        accountId: "account_secret",
        plan: "full",
        interval: "year",
      },
      "checkout-generation",
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { plan: "full", interval: "year" } }),
      { idempotencyKey: "checkout-generation" },
    );
    await expect(provider.findLatestCheckoutSession("cus_secret")).resolves.toEqual({
      id: "cs_test_open",
      customerId: "cus_secret",
      status: "open",
      url: "https://checkout.stripe.test/open",
      plan: "full",
      interval: "year",
    });
    expect(list).toHaveBeenCalledWith({ customer: "cus_secret", limit: 1 });
  });

  it("初回対象のCheckoutだけ14日間trialをStripeへ指定する", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cs_trial",
      url: "https://checkout.stripe.test/session",
    });
    const provider = new StripeBillingProvider({ checkout: { sessions: { create } } } as never);

    await provider.createCheckoutSession(
      {
        customerId: "cus_trial",
        priceId: "price_lite",
        successUrl: "https://example.test/success",
        cancelUrl: "https://example.test/cancel",
        accountId: "account_trial",
        plan: "lite",
        interval: "month",
        trialPeriodDays: 14,
      },
      "checkout-key",
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_data: { trial_period_days: 14 } }),
      { idempotencyKey: "checkout-key" },
    );
  });

  it("maps SDK subscriptions to the minimal provider contract", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: "sub_secret",
      customer: "cus_secret",
      status: "active",
      cancel_at_period_end: false,
      trial_end: null,
      created: 1_754_006_400,
      items: {
        data: [
          {
            price: { id: "price_internal" },
            current_period_start: 1_754_006_400,
            current_period_end: 1_756_684_800,
          },
        ],
      },
    });
    const provider = new StripeBillingProvider({ subscriptions: { retrieve } } as never);

    await expect(provider.retrieveSubscription("sub_secret")).resolves.toEqual({
      id: "sub_secret",
      itemId: null,
      scheduleId: null,
      customerId: "cus_secret",
      status: "active",
      priceId: "price_internal",
      interval: null,
      currentPeriodStart: "2025-08-01T00:00:00.000Z",
      currentPeriodEnd: "2025-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      createdAt: "2025-08-01T00:00:00.000Z",
    });
  });

  it("未知のsubscription statusを有料権限へ変換しない", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: "sub_unknown_status",
      customer: "cus_secret",
      status: "future_paid_status",
      cancel_at_period_end: false,
      trial_end: null,
      created: 1_754_006_400,
      items: {
        data: [
          {
            price: { id: "price_full" },
            current_period_start: 1_754_006_400,
            current_period_end: 1_756_684_800,
          },
        ],
      },
    });
    const provider = new StripeBillingProvider({ subscriptions: { retrieve } } as never);

    await expect(provider.retrieveSubscription("sub_unknown_status")).resolves.toMatchObject({
      status: "incomplete",
      priceId: "price_full",
    });
  });

  it("異なるProductへの期間末変更を冪等なSubscription Scheduleとして作成する", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "sub_sched_secret",
      current_phase: { start_date: 1_754_006_400, end_date: 1_756_684_800 },
    });
    const update = vi.fn().mockResolvedValue({ id: "sub_sched_secret" });
    const provider = new StripeBillingProvider({
      subscriptionSchedules: { create, update },
    } as never);

    await expect(
      provider.scheduleSubscriptionChange(
        {
          subscriptionId: "sub_secret",
          currentPriceId: "price_full_month",
          currentTrialEnd: "2025-09-01T00:00:00.000Z",
          targetPriceId: "price_lite_month",
          targetInterval: "month",
        },
        "plan-change-key",
      ),
    ).resolves.toEqual({ effectiveAt: "2025-09-01T00:00:00.000Z" });
    expect(create).toHaveBeenCalledWith(
      { from_subscription: "sub_secret" },
      { idempotencyKey: "plan-change-key" },
    );
    expect(update).toHaveBeenCalledWith(
      "sub_sched_secret",
      {
        end_behavior: "release",
        proration_behavior: "none",
        phases: [
          {
            start_date: 1_754_006_400,
            end_date: 1_756_684_800,
            items: [{ price: "price_full_month", quantity: 1 }],
            proration_behavior: "none",
            trial_end: 1_756_684_800,
          },
          {
            start_date: 1_756_684_800,
            duration: { interval: "month", interval_count: 1 },
            items: [{ price: "price_lite_month", quantity: 1 }],
            proration_behavior: "none",
          },
        ],
      },
      { idempotencyKey: "plan-change-key-phases" },
    );
  });

  it.each([
    ["StripeConnectionError", "ETIMEDOUT", "timeout", true],
    ["StripeConnectionError", undefined, "network", true],
    ["StripeRateLimitError", undefined, "rate-limited", true],
    ["StripeInvalidRequestError", undefined, "invalid-request", false],
    ["StripeSignatureVerificationError", undefined, "invalid-signature", false],
  ])("classifies %s without exposing SDK messages", (type, code, kind, retryable) => {
    const source = { type, code, message: "contains secret customer and payment data" };
    const classified = classifyStripeError(source);
    expect(classified).toMatchObject({ kind, retryable });
    expect(classified.message).not.toContain(source.message);
  });

  it("keeps fake failures inside the shared error contract", () => {
    const error = new BillingProviderError("provider", true, 503);
    expect(classifyStripeError(error)).toBe(error);
  });

  it("uses the managed Customer Portal configuration when creating a session", async () => {
    const create = vi.fn().mockResolvedValue({ url: "https://billing.stripe.test/session" });
    const provider = new StripeBillingProvider(
      { billingPortal: { sessions: { create } } } as never,
      { portalConfigurationId: "bpc_managed" },
    );

    await provider.createPortalSession({
      customerId: "cus_secret",
      returnUrl: "https://example.com/settings",
    });

    expect(create).toHaveBeenCalledWith({
      customer: "cus_secret",
      return_url: "https://example.com/settings",
      configuration: "bpc_managed",
    });
  });

  it("月額から年額はbilling cycle reset設定のPortal確認画面を使う", async () => {
    const create = vi.fn().mockResolvedValue({ url: "https://billing.stripe.test/change" });
    const provider = new StripeBillingProvider(
      { billingPortal: { sessions: { create } } } as never,
      {
        portalConfigurationId: "bpc_standard",
        portalResetConfigurationId: "bpc_reset",
      },
    );

    await provider.createPortalSession({
      customerId: "cus_secret",
      returnUrl: "https://example.com/billing",
      planChange: {
        subscriptionId: "sub_secret",
        itemId: "si_secret",
        targetPriceId: "price_year",
        billingCycleAnchor: "now",
      },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: "bpc_reset",
        flow_data: expect.objectContaining({
          type: "subscription_update_confirm",
          subscription_update_confirm: {
            subscription: "sub_secret",
            items: [{ id: "si_secret", price: "price_year", quantity: 1 }],
          },
        }),
      }),
    );
  });
});
