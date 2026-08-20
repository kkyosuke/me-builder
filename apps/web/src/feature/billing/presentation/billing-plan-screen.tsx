import type { BillingInterval, PaidPlanCode } from "@me-builder/shared";
import { ArrowLeft, Check, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AsyncState } from "../../../model/async-state";
import type { ProfileEntitlement } from "../../profile-settings/model/entitlement";
import type { GoalFollowUpItem, GoalFollowUpResult } from "../../profile/model/goal-follow-up";
import {
  type BillingPlan,
  billingPlanAnnualSavings,
  billingPlanPrice,
  formatBillingAmount,
  isBillingPlanDowngrade,
} from "../model/billing-plan";
import { expectedTrialEndDate } from "../model/trial";

const planNames = {
  free: "Free",
  lite: "Lite",
  full: "Full",
  family: "ファミリーパック",
} as const;

const planTabNames = {
  lite: "ノーマル",
  full: "プレミアム",
  family: "ファミリー",
} as const;

export function BillingPlanScreen({
  plans,
  entitlement,
  goalFollowUps = { status: "loading" },
  checkoutState,
  completionMessage,
  onBack,
  onCheckout,
  onManageSubscription,
  onRetry,
  paidPlansAvailable = true,
}: {
  plans: AsyncState<readonly BillingPlan[]>;
  entitlement: AsyncState<ProfileEntitlement>;
  goalFollowUps?: AsyncState<GoalFollowUpResult>;
  checkoutState: AsyncState<string>;
  completionMessage: string | null;
  onBack: () => void;
  onCheckout: (plan: PaidPlanCode, interval: BillingInterval) => void;
  onManageSubscription: () => void;
  onRetry: () => void;
  paidPlansAvailable?: boolean;
}) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [selectedPlan, setSelectedPlan] = useState<PaidPlanCode | null>(null);
  const [pendingDowngrade, setPendingDowngrade] = useState<Readonly<{
    plan: PaidPlanCode;
    interval: BillingInterval;
    stoppedGoals: readonly GoalFollowUpItem[];
  }> | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const confirmDowngradeRef = useRef<HTMLButtonElement>(null);
  const paidSubscription =
    entitlement.status === "success" && entitlement.data.source === "subscription";
  const familySeat = entitlement.status === "success" && entitlement.data.source === "family-seat";
  const safeDefault =
    entitlement.status === "success" && entitlement.data.status === "safe-default";
  const currentPlan = entitlement.status === "success" ? entitlement.data.plan : "free";
  const selected =
    plans.status === "success"
      ? (plans.data.find((plan) => plan.code === selectedPlan) ??
        plans.data.find((plan) => plan.code === currentPlan) ??
        plans.data[0] ??
        null)
      : null;
  const selectedPlanIsDowngrade =
    selected !== null && isBillingPlanDowngrade(currentPlan, selected.code);
  const annualSavings = selected ? billingPlanAnnualSavings(selected) : null;
  const stoppedGoals =
    selected?.code === "lite" && goalFollowUps.status === "success"
      ? [...goalFollowUps.data.items]
          .filter(({ status }) => status === "active")
          .sort(
            (left, right) =>
              Date.parse(left.agreedAt) - Date.parse(right.agreedAt) ||
              left.id.localeCompare(right.id),
          )
          .slice(0, -1)
      : [];
  const goalCheckUnavailable =
    selectedPlanIsDowngrade && selected?.code === "lite" && goalFollowUps.status !== "success";

  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (pendingDowngrade) confirmDowngradeRef.current?.focus();
  }, [pendingDowngrade]);

  const requestCheckout = () => {
    if (!selected || goalCheckUnavailable) return;
    if (selectedPlanIsDowngrade && stoppedGoals.length > 0) {
      setPendingDowngrade({ plan: selected.code, interval, stoppedGoals });
      return;
    }
    onCheckout(selected.code, interval);
  };

  const actionLabel =
    checkoutState.status === "loading"
      ? selectedPlanIsDowngrade
        ? "変更を予約しています..."
        : "Stripeを開いています..."
      : paidSubscription
        ? selectedPlanIsDowngrade
          ? "期間末の変更を予約"
          : "プランを変更する"
        : "プランを変更する";

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="billing-plan-title"
      className="fixed inset-0 z-[70] m-0 h-full max-h-none w-full max-w-none overflow-y-auto border-0 bg-slate-50 p-0 text-slate-950 dark:bg-slate-950 dark:text-white"
    >
      <div className="mx-auto min-h-full w-full max-w-3xl px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <header className="flex items-center gap-3">
          <button
            ref={backButtonRef}
            type="button"
            onClick={onBack}
            aria-label="料金プランを閉じる"
            className="flex size-11 items-center justify-center rounded-full bg-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-slate-800"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <div>
            <p className="text-xs font-bold tracking-wider text-violet-700 dark:text-violet-200">
              PLAN
            </p>
            <h1 id="billing-plan-title" className="text-2xl font-bold">
              料金プラン
            </h1>
          </div>
        </header>

        {completionMessage && (
          <output className="mt-4 block rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
            {completionMessage}
          </output>
        )}

        {checkoutState.status === "success" && (
          <output className="mt-4 block rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100">
            Stripe画面を開きました。表示されない場合は
            <a href={checkoutState.data} className="ml-1 font-bold underline underline-offset-2">
              こちらからStripeを開いてください
            </a>
            。
          </output>
        )}

        {checkoutState.status === "error" && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
          >
            {checkoutState.message}
          </p>
        )}

        <section className="mt-4 flex min-h-16 items-center justify-between gap-4 rounded-xl bg-white px-4 py-3 shadow-sm dark:bg-slate-900">
          <div>
            <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400">現在のプラン</h2>
            {!paidPlansAvailable ? (
              <p className="mt-0.5 text-lg font-bold">Free</p>
            ) : entitlement.status === "loading" || entitlement.status === "idle" ? (
              <output
                aria-busy="true"
                aria-label="現在のプランを読み込んでいます"
                className="mt-2 block h-6 w-24 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-700"
              />
            ) : entitlement.status === "error" ? (
              <p role="alert" className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                {entitlement.message}
              </p>
            ) : (
              <p className="mt-0.5 text-lg font-bold">
                {safeDefault ? "契約状態を確認中" : planNames[entitlement.data.plan]}
              </p>
            )}
          </div>
          {paidPlansAvailable && paidSubscription && (
            <button
              type="button"
              disabled={checkoutState.status === "loading"}
              onClick={onManageSubscription}
              className="min-h-10 shrink-0 rounded-lg border border-sky-300 px-3 text-sm font-bold text-sky-800 disabled:cursor-wait disabled:opacity-60 dark:border-sky-700 dark:text-sky-200"
            >
              契約を管理
            </button>
          )}
        </section>

        {paidPlansAvailable && safeDefault && (
          <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <h2 className="font-bold">現在の契約状態を確認できません</h2>
            <output className="mt-2 block text-sm">
              Free契約へ変更されたことを示す表示ではありません。確認が終わるまで安全側の利用枠を適用し、重複購入を防ぐため購入操作を停止しています。
            </output>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 min-h-10 rounded-lg border border-amber-500 px-4 text-sm font-bold"
            >
              契約状態を再確認
            </button>
          </section>
        )}

        {!paidPlansAvailable ? (
          <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
            <h2 className="font-bold">現在は無料で利用できます</h2>
            <p className="mt-2 text-sm">有料プランは現在提供していません。</p>
          </section>
        ) : familySeat ? (
          <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
            <h2 className="font-bold">ファミリーパックに参加中です</h2>
            <p className="mt-2 text-sm">
              個人契約を購入するには、先にファミリー席から退出してください。
            </p>
          </section>
        ) : (
          <section aria-labelledby="plan-selection-title" className="mt-4 pb-2">
            <h2 id="plan-selection-title" className="text-lg font-bold">
              プランを選ぶ
            </h2>

            {plans.status === "loading" || plans.status === "idle" ? (
              <output
                aria-busy="true"
                aria-label="料金プランを読み込んでいます"
                className="mt-3 block h-56 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800"
              />
            ) : plans.status === "error" ? (
              <div className="mt-3 rounded-xl bg-rose-50 p-4 dark:bg-rose-950">
                <p role="alert" className="text-sm text-rose-900 dark:text-rose-100">
                  {plans.message}
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 min-h-10 rounded-lg bg-rose-700 px-4 font-bold text-white"
                >
                  再試行
                </button>
              </div>
            ) : plans.data.length === 0 ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-center dark:border-slate-700 dark:bg-slate-900">
                <output className="block text-sm text-slate-600 dark:text-slate-300">
                  購入できる料金プランを表示できませんでした。
                </output>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 min-h-10 rounded-lg border border-violet-400 px-4 font-bold text-violet-700 dark:text-violet-200"
                >
                  再読み込み
                </button>
              </div>
            ) : (
              <>
                <fieldset className="mt-3">
                  <legend className="sr-only">プラン種別</legend>
                  <div className="grid grid-cols-3 rounded-xl bg-slate-200 p-1 dark:bg-slate-800">
                    {plans.data.map((plan) => (
                      <label
                        key={plan.code}
                        className={`flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-lg px-1 text-center ${selected?.code === plan.code ? "bg-white text-violet-700 shadow-sm dark:bg-slate-700 dark:text-violet-200" : "text-slate-600 dark:text-slate-300"}`}
                      >
                        <input
                          type="radio"
                          name="billing-plan"
                          value={plan.code}
                          checked={selected?.code === plan.code}
                          onChange={() => setSelectedPlan(plan.code)}
                          className="sr-only"
                        />
                        <span className="text-sm font-bold">{planTabNames[plan.code]}</span>
                        <span className="text-[10px]">{plan.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-3">
                  <legend className="sr-only">支払い間隔</legend>
                  <div className="grid grid-cols-2 rounded-xl bg-slate-200 p-1 dark:bg-slate-800">
                    {(["month", "year"] as const).map((value) => (
                      <label
                        key={value}
                        className={`flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-lg text-sm font-bold ${interval === value ? "bg-white text-violet-700 shadow-sm dark:bg-slate-700 dark:text-violet-200" : "text-slate-600 dark:text-slate-300"}`}
                      >
                        <input
                          type="radio"
                          name="billing-interval"
                          value={value}
                          aria-label={value === "month" ? "月額" : "年額"}
                          checked={interval === value}
                          onChange={() => setInterval(value)}
                          className="sr-only"
                        />
                        {value === "month" ? "月額" : "年額"}
                        {value === "year" && annualSavings && (
                          <span
                            aria-hidden="true"
                            className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                          >
                            {annualSavings.equivalentFreeMonths}か月分お得
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {selected && (
                  <article className="mt-3 rounded-2xl border border-violet-200 bg-white p-4 shadow-sm dark:border-violet-800 dark:bg-slate-900">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-violet-700 dark:text-violet-200">
                          {planTabNames[selected.code]}
                        </p>
                        <h3 className="text-xl font-bold">{selected.name}</h3>
                      </div>
                      <p className="shrink-0 text-right text-2xl font-bold">
                        {formatBillingAmount(billingPlanPrice(selected, interval).amount)}
                        <span className="block text-xs font-normal text-slate-500">
                          税込 / {interval === "month" ? "月" : "年"}
                        </span>
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {selected.description}
                    </p>

                    {interval === "year" && annualSavings && (
                      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
                        <p className="text-sm font-bold">
                          月額払いより年間{formatBillingAmount(annualSavings.amount)}お得
                          <span className="ml-1 rounded-full bg-emerald-700 px-2 py-0.5 text-xs text-white">
                            約{annualSavings.percentage}%OFF
                          </span>
                        </p>
                        <p className="mt-1 text-xs">
                          月あたり約
                          {formatBillingAmount(annualSavings.monthlyEquivalent)}で利用できます。
                        </p>
                      </div>
                    )}

                    {selected.trialDays && (
                      <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                        <p className="font-bold">初回{selected.trialDays}日間無料トライアル</p>
                        <p className="mt-1">
                          本日開始した場合は{expectedTrialEndDate(selected.trialDays)}まで無料です。
                          終了後は
                          {formatBillingAmount(billingPlanPrice(selected, interval).amount)}を
                          {interval === "month" ? "毎月" : "毎年"}自動更新します。
                        </p>
                      </div>
                    )}

                    <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
                      {selected.highlights.map((highlight) => (
                        <li key={highlight} className="flex gap-2">
                          <Check
                            className="mt-0.5 size-4 shrink-0 text-emerald-600"
                            aria-hidden="true"
                          />
                          {highlight}
                        </li>
                      ))}
                    </ul>

                    <dl className="mt-3 grid gap-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-700 sm:grid-cols-2">
                      <div>
                        <dt className="font-bold">請求・変更</dt>
                        <dd className="mt-0.5 text-slate-600 dark:text-slate-300">
                          {paidSubscription && selectedPlanIsDowngrade
                            ? "現在の期間終了時に変更し、それまでは現在のプランを維持"
                            : paidSubscription
                              ? "Stripeで差額と次回更新日を確認してから変更"
                              : selected.trialDays
                                ? "無料期間終了後、選択した間隔で自動更新"
                                : "支払方法の登録後、選択した間隔で自動更新"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold">解約</dt>
                        <dd className="mt-0.5 text-slate-600 dark:text-slate-300">
                          契約管理からいつでも期間末解約を予約できます。
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 flex gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
                      カード情報はStripeが扱い、me-builderには保存されません。
                    </p>
                  </article>
                )}
              </>
            )}
          </section>
        )}

        {paidPlansAvailable &&
          selected &&
          !familySeat &&
          !safeDefault &&
          entitlement.status === "success" && (
            <>
              <div className="h-28" aria-hidden="true" />
              <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-slate-50/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:px-6">
                <div className="mx-auto flex max-w-3xl items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      {planTabNames[selected.code]}（{selected.name}）
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatBillingAmount(billingPlanPrice(selected, interval).amount)} /
                      {interval === "month" ? "月" : "年"}
                    </p>
                    {interval === "year" && annualSavings && (
                      <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        年間{formatBillingAmount(annualSavings.amount)}お得
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={checkoutState.status === "loading" || goalCheckUnavailable}
                    onClick={requestCheckout}
                    className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-700 px-5 font-bold text-white shadow-lg disabled:cursor-wait disabled:opacity-60 sm:min-w-56"
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    {actionLabel}
                  </button>
                </div>
              </footer>
            </>
          )}

        {goalCheckUnavailable && (
          <p role="alert" className="pb-4 text-center text-sm text-rose-700 dark:text-rose-300">
            停止予定のGoalを確認できないため、プラン変更を開始できません。再読み込みしてください。
          </p>
        )}

        {pendingDowngrade && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4">
            <section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="goal-downgrade-confirmation-title"
              className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
            >
              <h2 id="goal-downgrade-confirmation-title" className="text-lg font-bold">
                停止予定のGoalを確認
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Liteが適用される時点で、合意日時が古い次のGoalを停止します。履歴は残り、上限に空きができた後は本人が再開できます。
              </p>
              <ul className="mt-3 space-y-2">
                {pendingDowngrade.stoppedGoals.map((goal) => (
                  <li key={goal.id} className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
                    <p className="font-bold">{goal.goal}</p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      次の一歩：{goal.nextStep}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPendingDowngrade(null)}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 font-bold dark:border-slate-700"
                >
                  変更しない
                </button>
                <button
                  ref={confirmDowngradeRef}
                  type="button"
                  onClick={() => {
                    const confirmed = pendingDowngrade;
                    setPendingDowngrade(null);
                    onCheckout(confirmed.plan, confirmed.interval);
                  }}
                  className="min-h-11 rounded-xl bg-violet-700 px-4 font-bold text-white"
                >
                  了承して変更へ進む
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </dialog>
  );
}
