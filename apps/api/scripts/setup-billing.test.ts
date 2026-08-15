import { describe, expect, it } from "vitest";
import { parseBillingCatalog } from "./setup-billing";

const catalog = {
  currency: "jpy",
  products: ["lite", "full", "family"].map((key) => ({
    key,
    name: key,
    prices: [
      { interval: "month", unitAmount: 100, lookupKey: `${key}_month` },
      { interval: "year", unitAmount: 1000, lookupKey: `${key}_year` },
    ],
  })),
  webhookEvents: ["customer.subscription.updated"],
};

describe("parseBillingCatalog", () => {
  it("accepts a complete replaceable catalog", () => {
    expect(parseBillingCatalog(catalog).products).toHaveLength(3);
  });

  it("rejects duplicate lookup keys", () => {
    const invalid = structuredClone(catalog);
    invalid.products[1].prices[0].lookupKey = "lite_month";
    expect(() => parseBillingCatalog(invalid)).toThrow("duplicate keys");
  });

  it("rejects a product without both billing intervals", () => {
    const invalid = structuredClone(catalog);
    invalid.products[1].prices[1].interval = "month";
    expect(() => parseBillingCatalog(invalid)).toThrow("monthly and yearly");
  });

  it("rejects an overlong lookup key before building a Stripe idempotency key", () => {
    const invalid = structuredClone(catalog);
    invalid.products[0].prices[0].lookupKey = "a".repeat(97);
    expect(() => parseBillingCatalog(invalid)).toThrow();
  });
});
