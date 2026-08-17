import { describe, expect, it } from "vitest";
import {
  billingIntervals,
  billingLookupKey,
  paidPlanCodes,
  publicBillingPlans,
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
});
