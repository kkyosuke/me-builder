import { describe, expect, it } from "vitest";
import {
  billingIntervals,
  billingLookupKey,
  paidPlanCodes,
  publicBillingPlans,
  publicPlanCodes,
  publicPlanFeatures,
} from "./plan-catalog";

describe("publicBillingPlans", () => {
  it("各有料Planの月額・年額を一意なlookup keyで公開する", () => {
    expect(publicBillingPlans.map((plan) => plan.code)).toEqual(paidPlanCodes);
    expect(publicBillingPlans.every((plan) => plan.trialDays === 14)).toBe(true);
    for (const plan of publicBillingPlans) {
      expect(plan.prices.map((price) => price.interval)).toEqual(billingIntervals);
      expect(plan.prices.every((price) => price.currency === "JPY" && price.amount > 0)).toBe(true);
    }
    const lookupKeys = publicBillingPlans.flatMap((plan) =>
      plan.prices.map((price) => price.lookupKey),
    );
    expect(new Set(lookupKeys).size).toBe(lookupKeys.length);
    expect(billingLookupKey("full", "year")).toBe("me_builder_full_yearly");
  });

  it("わたしのまとめを全Plan共通機能として公開する", () => {
    const summary = publicPlanFeatures.find((feature) => feature.label === "わたしのまとめ");

    expect(summary).toBeDefined();
    expect(Object.keys(summary?.plans ?? {})).toEqual(publicPlanCodes);
    expect(Object.values(summary?.plans ?? {}).every((value) => value.includes("利用可能"))).toBe(
      true,
    );
    expect(publicBillingPlans.flatMap((plan) => plan.highlights).join(" ")).not.toMatch(
      /わたしのまとめ 月/u,
    );
  });
});
