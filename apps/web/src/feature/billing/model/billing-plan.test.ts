import { describe, expect, it } from "vitest";
import {
  type BillingPlan,
  billingPlanAnnualSavings,
  billingPlanPrice,
  formatBillingAmount,
  isBillingPlanDowngrade,
} from "./billing-plan";

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
  it("Freeと有料Planの順序から期間末変更を判定する", () => {
    expect(isBillingPlanDowngrade("free", "lite")).toBe(false);
    expect(isBillingPlanDowngrade("lite", "full")).toBe(false);
    expect(isBillingPlanDowngrade("family", "full")).toBe(true);
  });

  it("選択した請求間隔の価格を解決する", () => {
    expect(billingPlanPrice(plan, "year").amount).toBe(7_800);
    expect(formatBillingAmount(7_800)).toMatch(/7,800/);
  });

  it("年額と月額12回の差からお得額を算出する", () => {
    expect(billingPlanAnnualSavings(plan)).toEqual({
      amount: 1_560,
      percentage: 17,
      monthlyEquivalent: 650,
      equivalentFreeMonths: 2,
    });
  });
});
