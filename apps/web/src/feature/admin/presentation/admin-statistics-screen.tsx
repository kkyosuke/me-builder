import { AlertCircle, Bot, MessageCircle, RefreshCw } from "lucide-react";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import type { AdminStatistics } from "../model/statistics";

const number = new Intl.NumberFormat("ja-JP");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});
const costIssueLabel = {
  "unsupported-model": "単価未対応モデル",
  "invalid-usage": "不正なtoken利用量",
  overflow: "料金計算の桁あふれ",
} as const;

function Unavailable({ reason }: { reason: "not-configured" | "upstream-error" }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      {reason === "not-configured"
        ? "集計用の環境設定がありません。"
        : "外部サービスから取得できませんでした。"}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 break-all text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Card({
  title,
  icon,
  children,
}: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Gemini({ value }: { value: AdminStatistics["gemini"] }) {
  return (
    <Card title="Gemini" icon={<Bot className="size-5 text-violet-500" aria-hidden="true" />}>
      {value.status === "unavailable" ? (
        <Unavailable reason={value.reason} />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="成功レスポンス" value={number.format(value.requestCount)} />
            <Metric label="入力token" value={number.format(value.inputTokens)} />
            <Metric label="出力token" value={number.format(value.outputTokens)} />
            <Metric
              label="生成概算料金（USD）"
              value={
                value.costEstimate.status === "available"
                  ? usd.format(value.costEstimate.amount)
                  : "算出不可"
              }
            />
          </dl>
          <h3 className="mt-5 text-sm font-semibold">Account別利用量</h3>
          {value.accounts.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              当月の利用Accountはありません。
            </p>
          ) : (
            <section
              aria-label="Account別利用量。横にスクロールできます"
              className="mt-2 max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-slate-200 dark:border-slate-700"
            >
              <table className="w-full min-w-2xl text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Account ID
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      レスポンス
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      入力token
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      出力token
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      生成概算料金（USD）
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {value.accounts.map((account) => (
                    <tr
                      key={account.accountId}
                      className="border-t border-slate-200 dark:border-slate-700"
                    >
                      <th scope="row" className="px-4 py-3 font-mono text-xs font-medium">
                        {account.accountId}
                      </th>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {number.format(account.requestCount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {number.format(account.inputTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {number.format(account.outputTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {account.estimatedCostUsd === null
                          ? "算出不可"
                          : usd.format(account.estimatedCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Google Vertex AIレスポンスのusageMetadataを集計しています。
        {value.status === "available" && value.costEstimate.status === "available"
          ? ` 料金は${value.costEstimate.pricingAsOf}時点のStandard・Global公開単価による概算です。`
          : ""}
        Embedding、無料枠、クレジット、税、為替は含まないため、実請求額とは異なります。単価は
        <a
          href="https://cloud.google.com/vertex-ai/generative-ai/pricing"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Google公式料金表
        </a>
        を参照しています。
      </p>
      {value.status === "available" && value.costEstimate.status === "unavailable" ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          概算料金を算出できません。
          {value.costEstimate.issues.map((issue) => (
            <span key={issue.reason} className="ml-1">
              {costIssueLabel[issue.reason]}: {issue.models.join("、")}
            </span>
          ))}
        </p>
      ) : null}
    </Card>
  );
}

function Line({ value }: { value: AdminStatistics["line"] }) {
  return (
    <Card
      title="LINE"
      icon={<MessageCircle className="size-5 text-emerald-500" aria-hidden="true" />}
    >
      {value.status === "unavailable" ? (
        <Unavailable reason={value.reason} />
      ) : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Metric label="課金対象送信数" value={number.format(value.billableMessages)} />
          <Metric
            label="当月送信上限"
            value={value.monthlyLimit === null ? "上限なし" : number.format(value.monthlyLimit)}
          />
          <Metric label="返信送信数（前日まで）" value={number.format(value.replyMessages)} />
        </dl>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        返信送信数は課金対象送信数に含まれません。
      </p>
    </Card>
  );
}

function StatisticsSkeleton() {
  return (
    <SkeletonLoader label="統計情報を読み込み中">
      <section className="mx-auto mt-6 max-w-4xl" aria-label="利用統計">
        <div className="mb-6 flex items-center justify-between gap-3">
          <SkeletonBlock className="h-6 w-24 rounded-full" />
          <SkeletonBlock className="h-10 w-20 rounded-full" />
        </div>
        <SkeletonBlock className="mb-6 h-4 w-56 rounded-full" />
        <div className="grid gap-5">
          {[
            { key: "gemini", metricKeys: ["request", "input", "output", "cost"] },
            { key: "line", metricKeys: ["billable", "limit", "reply"] },
          ].map(({ key, metricKeys }) => (
            <section
              key={key}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex items-center gap-2">
                <SkeletonBlock className="size-5 rounded-md" />
                <SkeletonBlock className="h-5 w-24 rounded-full" />
              </div>
              <div
                className={`mt-4 grid gap-3 sm:grid-cols-2 ${key === "gemini" ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
              >
                {metricKeys.map((metricKey) => (
                  <div key={metricKey} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900">
                    <SkeletonBlock className="h-3 w-20 rounded-full" />
                    <SkeletonBlock className="mt-3 h-6 w-24 rounded-full" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </SkeletonLoader>
  );
}

export function AdminStatisticsScreen({
  state,
  isRefreshing = false,
  onReload,
}: {
  state: AsyncState<AdminStatistics>;
  isRefreshing?: boolean;
  onReload: () => void;
}) {
  if (state.status === "loading" || state.status === "idle") {
    return <StatisticsSkeleton />;
  }
  if (state.status === "error")
    return (
      <section className="mx-auto flex min-h-[50vh] max-w-4xl flex-col items-center justify-center gap-4 text-center">
        <AlertCircle className="size-10 text-rose-500" aria-hidden="true" />
        <p>{state.message}</p>
        <button
          type="button"
          onClick={onReload}
          className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-900"
        >
          再読み込み
        </button>
      </section>
    );
  const { data } = state;
  return (
    <section className="mx-auto mt-6 max-w-4xl min-w-0" aria-labelledby="statistics-heading">
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="statistics-heading" className="min-w-0 text-xl font-bold">
            利用統計
          </h2>
          <button
            type="button"
            onClick={onReload}
            disabled={isRefreshing}
            aria-label={isRefreshing ? "統計情報を更新中" : undefined}
            className="flex shrink-0 items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
          >
            <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "更新中..." : "更新"}
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {new Date(data.period.start).toLocaleDateString("ja-JP")}〜
          {new Date(data.period.end).toLocaleString("ja-JP")}
        </p>
      </header>
      <div className="grid min-w-0 gap-5">
        <Gemini value={data.gemini} />
        <Line value={data.line} />
      </div>
    </section>
  );
}
