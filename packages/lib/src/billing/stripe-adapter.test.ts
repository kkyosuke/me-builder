import { describe, expect, it, vi } from "vitest";
import { BillingProviderError } from "./provider";
import { StripeBillingProvider, classifyStripeError } from "./stripe-adapter";

describe("StripeBillingProvider", () => {
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
      customerId: "cus_secret",
      status: "active",
      priceId: "price_internal",
      currentPeriodStart: "2025-08-01T00:00:00.000Z",
      currentPeriodEnd: "2025-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      createdAt: "2025-08-01T00:00:00.000Z",
    });
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
});
