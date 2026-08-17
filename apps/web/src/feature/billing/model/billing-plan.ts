import type { BillingInterval, PaidPlanCode } from "@me-builder/shared";

export type BillingPlan = Readonly<{
  code: PaidPlanCode;
  name: string;
  description: string;
  highlights: readonly string[];
  trialDays: number | null;
  prices: readonly Readonly<{
    interval: BillingInterval;
    amount: number;
    currency: "JPY";
  }>[];
}>;

export function billingPlanPrice(plan: BillingPlan, interval: BillingInterval) {
  const price = plan.prices.find((candidate) => candidate.interval === interval);
  if (!price) throw new Error("選択した請求間隔の価格がありません。");
  return price;
}

export function billingPlanAnnualSavings(plan: BillingPlan) {
  const monthly = billingPlanPrice(plan, "month").amount;
  const yearly = billingPlanPrice(plan, "year").amount;
  const monthlyAnnualTotal = monthly * 12;
  const amount = monthlyAnnualTotal - yearly;
  if (amount <= 0) return null;
  return {
    amount,
    percentage: Math.round((amount / monthlyAnnualTotal) * 100),
    monthlyEquivalent: Math.round(yearly / 12),
    equivalentFreeMonths: Math.round(amount / monthly),
  };
}

export function formatBillingAmount(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(amount);
}
