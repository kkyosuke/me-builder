import type { BillingInterval, PaidPlanCode } from "@me-builder/shared";
import { ArrowLeft, Check, CreditCard, ExternalLink, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { AsyncState } from "../../../model/async-state";
import type { ProfileEntitlement } from "../../profile-settings/model/entitlement";
import { type BillingPlan, billingPlanPrice, formatBillingAmount } from "../model/billing-plan";

export function BillingPlanScreen({
  plans,
  entitlement,
  checkoutState,
  completionMessage,
  onBack,
  onCheckout,
  onRetry,
}: {
  plans: AsyncState<readonly BillingPlan[]>;
  entitlement: AsyncState<ProfileEntitlement>;
  checkoutState: AsyncState<string>;
  completionMessage: string | null;
  onBack: () => void;
  onCheckout: (plan: PaidPlanCode, interval: BillingInterval) => void;
  onRetry: () => void;
}) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [selectedPlan, setSelectedPlan] = useState<PaidPlanCode | null>(null);
  const selected =
    plans.status === "success"
      ? (plans.data.find((plan) => plan.code === selectedPlan) ?? null)
      : null;
  const paidSubscription =
    entitlement.status === "success" && entitlement.data.source === "subscription";

  return (
    <dialog
      open
      aria-labelledby="billing-plan-title"
      className="fixed inset-0 z-[70] m-0 h-full max-h-none w-full max-w-none overflow-y-auto border-0 bg-slate-50 p-0 text-slate-950 dark:bg-slate-950 dark:text-white"
    >
      <div className="mx-auto min-h-full w-full max-w-5xl px-4 pb-12 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <header className="flex items-center gap-3">
          <button
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
          <output className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
            {completionMessage}
          </output>
        )}

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <h2 className="font-bold">現在のプラン</h2>
          {entitlement.status === "loading" || entitlement.status === "idle" ? (
            <output
              aria-busy="true"
              aria-label="現在のプランを読み込んでいます"
              className="mt-3 block h-12 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-700"
            />
          ) : entitlement.status === "error" ? (
            <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
              {entitlement.message}
            </p>
          ) : (
            <p className="mt-2 text-lg font-bold">
              {
                ({ free: "Free", lite: "Lite", full: "Full", family: "ファミリーパック" } as const)[
                  entitlement.data.plan
                ]
              }
            </p>
          )}
        </section>

        {paidSubscription ? (
          <section className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
            <h2 className="font-bold">現在の契約があります</h2>
            <p className="mt-2 text-sm">
              二重購入を防ぐため、新しい購入は開始できません。プロフィールの「契約を管理」から支払方法、請求履歴、解約を確認してください。
            </p>
          </section>
        ) : (
          <>
            <fieldset className="mt-8">
              <legend className="text-sm font-bold">支払い間隔</legend>
              <div className="mt-3 grid grid-cols-2 rounded-xl bg-slate-200 p-1 dark:bg-slate-800">
                {(["month", "year"] as const).map((value) => (
                  <label
                    key={value}
                    className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg font-bold ${interval === value ? "bg-white text-violet-700 shadow-sm dark:bg-slate-700 dark:text-violet-200" : "text-slate-600 dark:text-slate-300"}`}
                  >
                    <input
                      type="radio"
                      name="billing-interval"
                      value={value}
                      checked={interval === value}
                      onChange={() => setInterval(value)}
                      className="sr-only"
                    />
                    {value === "month" ? "月額" : "年額"}
                  </label>
                ))}
              </div>
            </fieldset>

            {plans.status === "loading" || plans.status === "idle" ? (
              <output
                aria-busy="true"
                aria-label="料金プランを読み込んでいます"
                className="mt-6 grid gap-4 sm:grid-cols-3"
              >
                {[0, 1, 2].map((value) => (
                  <span
                    key={value}
                    className="block h-80 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800"
                  />
                ))}
              </output>
            ) : plans.status === "error" ? (
              <div className="mt-6 rounded-2xl bg-rose-50 p-5 dark:bg-rose-950">
                <p role="alert" className="text-sm text-rose-900 dark:text-rose-100">
                  {plans.message}
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-4 min-h-11 rounded-xl bg-rose-700 px-4 font-bold text-white"
                >
                  再試行
                </button>
              </div>
            ) : plans.data.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-center dark:border-slate-700 dark:bg-slate-900">
                <output className="block text-sm text-slate-600 dark:text-slate-300">
                  購入できる料金プランを表示できませんでした。
                </output>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-4 min-h-11 rounded-xl border border-violet-400 px-4 font-bold text-violet-700 dark:text-violet-200"
                >
                  再読み込み
                </button>
              </div>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {plans.data.map((plan) => {
                  const price = billingPlanPrice(plan, interval);
                  return (
                    <article
                      key={plan.code}
                      className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${plan.code === "full" ? "border-violet-400 ring-1 ring-violet-300 dark:border-violet-600" : "border-slate-200 dark:border-slate-700"}`}
                    >
                      <h2 className="text-xl font-bold">{plan.name}</h2>
                      <p className="mt-2 min-h-16 text-sm text-slate-600 dark:text-slate-300">
                        {plan.description}
                      </p>
                      <p className="mt-4 text-3xl font-bold">
                        {formatBillingAmount(price.amount)}
                        <span className="text-sm font-normal text-slate-500">
                          /{interval === "month" ? "月" : "年"}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-slate-500">税込・自動更新</p>
                      <ul className="mt-5 flex-1 space-y-2 text-sm">
                        {plan.highlights.map((highlight) => (
                          <li key={highlight} className="flex gap-2">
                            <Check
                              className="mt-0.5 size-4 shrink-0 text-emerald-600"
                              aria-hidden="true"
                            />
                            {highlight}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => setSelectedPlan(plan.code)}
                        className="mt-6 min-h-12 rounded-xl bg-violet-700 px-4 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                      >
                        {plan.name}を選ぶ
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {selected && (
          <section
            aria-labelledby="checkout-confirmation-title"
            className="mt-8 rounded-2xl border-2 border-violet-300 bg-white p-6 shadow-lg dark:border-violet-700 dark:bg-slate-900"
          >
            <div className="flex items-center gap-3">
              <CreditCard
                className="size-6 text-violet-700 dark:text-violet-200"
                aria-hidden="true"
              />
              <h2 id="checkout-confirmation-title" className="text-xl font-bold">
                申込み内容の確認
              </h2>
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">プラン</dt>
                <dd className="mt-1 font-bold">{selected.name}</dd>
              </div>
              <div>
                <dt className="text-slate-500">支払額</dt>
                <dd className="mt-1 font-bold">
                  {formatBillingAmount(billingPlanPrice(selected, interval).amount)}（税込）/
                  {interval === "month" ? "月" : "年"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">請求</dt>
                <dd className="mt-1">Stripeで支払方法を登録した後、選択した間隔で自動更新</dd>
              </div>
              <div>
                <dt className="text-slate-500">解約</dt>
                <dd className="mt-1">契約管理からいつでも期間末解約を予約可能</dd>
              </div>
            </dl>
            <p className="mt-5 flex gap-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              カード情報はStripeが扱い、me-builderには保存されません。
            </p>
            {checkoutState.status === "error" && (
              <p role="alert" className="mt-4 text-sm text-rose-700 dark:text-rose-300">
                {checkoutState.message}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row-reverse">
              <button
                type="button"
                disabled={checkoutState.status === "loading"}
                onClick={() => onCheckout(selected.code, interval)}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-700 px-5 font-bold text-white disabled:cursor-wait disabled:opacity-60"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                {checkoutState.status === "loading"
                  ? "Stripeを開いています..."
                  : "Stripeで購入手続きへ"}
              </button>
              <button
                type="button"
                onClick={() => setSelectedPlan(null)}
                className="min-h-12 rounded-xl border border-slate-300 px-5 font-bold dark:border-slate-700"
              >
                選び直す
              </button>
            </div>
          </section>
        )}
      </div>
    </dialog>
  );
}
