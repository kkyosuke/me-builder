export const paidPlanCodes = ["lite", "full", "family"] as const;
export type PaidPlanCode = (typeof paidPlanCodes)[number];
export const publicPlanCodes = ["free", ...paidPlanCodes] as const;
export type PublicPlanCode = (typeof publicPlanCodes)[number];

/** Planの価値差には使わない、全Account共通のまとめ生成月次運用上限。 */
export const PROFILE_SUMMARY_MONTHLY_LIMIT = 4;

/** 公開料金表とEntitlementが共有する、PlanごとのAI返信月次上限。 */
export const AI_REPLY_MONTHLY_LIMITS = {
  free: 60,
  lite: 150,
  full: 600,
  family: 600,
} as const satisfies Readonly<Record<PublicPlanCode, number>>;

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

export const publicFreePlan = {
  code: "free",
  name: "Free",
  description: "記録、診断、最初の自己理解を自分のペースで続けるプラン",
  highlights: [
    `AI返信 月${AI_REPLY_MONTHLY_LIMITS.free}回`,
    "AIによる意味検索 直近30日",
    "一般的なセルフケア案内",
  ],
} as const;

export type PublicPlanFeature = Readonly<{
  label: string;
  plans: Readonly<Record<PublicPlanCode, string>>;
}>;

/** 公開料金表で表示する、Planごとの主要機能比較。 */
export const publicPlanFeatures = [
  {
    label: "AI返信",
    plans: {
      free: `月${AI_REPLY_MONTHLY_LIMITS.free}回`,
      lite: `月${AI_REPLY_MONTHLY_LIMITS.lite}回`,
      full: `月${AI_REPLY_MONTHLY_LIMITS.full}回`,
      family: `1人あたり月${AI_REPLY_MONTHLY_LIMITS.family}回`,
    },
  },
  {
    label: "今週の振り返り",
    plans: { free: "—", lite: "週1回", full: "週1回", family: "1人ずつ週1回" },
  },
  {
    label: "月ごとの変化",
    plans: { free: "—", lite: "主な変化", full: "根拠を含む詳しい変化", family: "Fullと同じ" },
  },
  {
    label: "AIによる意味検索",
    plans: {
      free: "直近30日",
      lite: "直近1年",
      full: "保存されている全期間",
      family: "Fullと同じ",
    },
  },
  {
    label: "行動のフォローアップ",
    plans: { free: "—", lite: "選んだ1件", full: "関連する継続中の行動", family: "Fullと同じ" },
  },
  {
    label: "AIセルフケア相談",
    plans: {
      free: "一般的な案と安全案内",
      lite: "確認済み情報を参照",
      full: "過去の対処と最近の状態を参照",
      family: "Fullと同じ",
    },
  },
  {
    label: "利用できるAccount数",
    plans: { free: "1", lite: "1", full: "1", family: "最大4" },
  },
] as const satisfies readonly PublicPlanFeature[];

/** Stripe catalogと購入画面が共有する、公開可能なPlan・価格の唯一のコード上の定義。 */
export const publicBillingPlans = [
  {
    code: "lite",
    name: "Lite",
    description: "日記と週次の振り返りを無理なく続けるプラン",
    highlights: ["AI返信 月150回", "今週の振り返り", "最近の変化と行動フォロー"],
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
    highlights: ["AI返信 月600回", "過去全体からの変化", "個別化セルフケア"],
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
