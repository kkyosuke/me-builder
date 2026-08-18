import { describe, expect, it } from "vitest";
import {
  AI_REPLY_MONTHLY_LIMITS,
  billingIntervals,
  billingLookupKey,
  paidPlanCodes,
  publicBillingPlans,
  publicFreePlan,
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

  it("共通機能を比較項目にせず、Plan差のあるAI返信上限を公開する", () => {
    expect(publicPlanFeatures.map(({ label }) => label)).not.toEqual(
      expect.arrayContaining([
        "LINEの日記保存",
        "公開中の診断と基本結果",
        "わたしのまとめ",
        "基本の相性シート",
        "2人の継続的な振り返り",
      ]),
    );
    expect(publicPlanFeatures.find(({ label }) => label === "AI返信")?.plans).toEqual({
      free: `月${AI_REPLY_MONTHLY_LIMITS.free}回`,
      lite: `月${AI_REPLY_MONTHLY_LIMITS.lite}回`,
      full: `月${AI_REPLY_MONTHLY_LIMITS.full}回`,
      family: `1人あたり月${AI_REPLY_MONTHLY_LIMITS.family}回`,
    });
    expect(publicFreePlan.highlights).toContain(`AI返信 月${AI_REPLY_MONTHLY_LIMITS.free}回`);
  });
});
