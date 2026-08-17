import { describe, expect, it } from "vitest";
import { type BillingPlan, billingPlanPrice, formatBillingAmount } from "./billing-plan";

const plan: BillingPlan = {
  code: "lite",
  name: "Lite",
  description: "description",
  highlights: [],
  trialDays: null,
  prices: [
    { interval: "month", amount: 780, currency: "JPY" },
    { interval: "year", amount: 7_800, currency: "JPY" },
  ],
};

describe("billing plan", () => {
  it("選択した請求間隔の価格を解決する", () => {
    expect(billingPlanPrice(plan, "year").amount).toBe(7_800);
    expect(formatBillingAmount(7_800)).toMatch(/7,800/);
  });
});
