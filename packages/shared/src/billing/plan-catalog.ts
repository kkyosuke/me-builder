export const paidPlanCodes = ["lite", "full", "family"] as const;
export type PaidPlanCode = (typeof paidPlanCodes)[number];

export const billingIntervals = ["month", "year"] as const;
export type BillingInterval = (typeof billingIntervals)[number];

export const BILLING_INITIAL_TRIAL_DAYS = 14 as const;

export type PublicBillingPlan = Readonly<{
  code: PaidPlanCode;
  name: string;
  description: string;
  highlights: readonly string[];
  trialDays: number | null;
  prices: readonly Readonly<{
    interval: BillingInterval;
    amount: number;
    currency: "JPY";
    lookupKey: string;
  }>[];
}>;

/** Stripe catalogと購入画面が共有する、公開可能なPlan・価格の唯一のコード上の定義。 */
export const publicBillingPlans = [
  {
    code: "lite",
    name: "Lite",
    description: "日記と週次の振り返りを無理なく続けるプラン",
    highlights: ["AI返信 月150回", "わたしのまとめ 月4回", "今週の振り返り"],
    trialDays: BILLING_INITIAL_TRIAL_DAYS,
    prices: [
      { interval: "month", amount: 780, currency: "JPY", lookupKey: "me_builder_lite_monthly" },
      { interval: "year", amount: 7_800, currency: "JPY", lookupKey: "me_builder_lite_yearly" },
    ],
  },
  {
    code: "full",
    name: "Full",
    description: "過去の記憶を使った助言、変化の確認、セルフケアを利用するプラン",
    highlights: ["AI返信 月600回", "わたしのまとめ 月12回", "過去の変化とセルフケア"],
    trialDays: BILLING_INITIAL_TRIAL_DAYS,
    prices: [
      { interval: "month", amount: 1_480, currency: "JPY", lookupKey: "me_builder_full_monthly" },
      { interval: "year", amount: 14_800, currency: "JPY", lookupKey: "me_builder_full_yearly" },
    ],
  },
  {
    code: "family",
    name: "ファミリーパック",
    description: "最大4 Accountで、それぞれの個人内容を分離したままFull相当を利用するプラン",
    highlights: ["最大4 Account", "1人あたりFull相当", "参加者の個人内容は共有しない"],
    trialDays: BILLING_INITIAL_TRIAL_DAYS,
    prices: [
      { interval: "month", amount: 2_980, currency: "JPY", lookupKey: "me_builder_family_monthly" },
      { interval: "year", amount: 29_800, currency: "JPY", lookupKey: "me_builder_family_yearly" },
    ],
  },
] as const satisfies readonly PublicBillingPlan[];

/** 購入・変更APIが使うlookup key。公開Plan catalogから導出し、環境設定へ複製しない。 */
export function billingLookupKey(plan: PaidPlanCode, interval: BillingInterval): string {
  const planDefinition = publicBillingPlans.find((candidate) => candidate.code === plan);
  const price = planDefinition?.prices.find((candidate) => candidate.interval === interval);
  if (!price) throw new Error(`Billing catalog is missing ${plan}.${interval}`);
  return price.lookupKey;
}
