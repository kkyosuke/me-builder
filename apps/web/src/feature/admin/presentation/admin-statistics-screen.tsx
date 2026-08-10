import { AlertCircle, Bot, MessageCircle, RefreshCw } from "lucide-react";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import type { AdminStatistics } from "../model/statistics";

const number = new Intl.NumberFormat("ja-JP");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

function Unavailable({ reason }: { reason: "not-configured" | "upstream-error" }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertCircle className="size-4" aria-hidden="true" />
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
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Card({
  title,
  icon,
  children,
}: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
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
        <dl className="grid grid-cols-2 gap-3">
          <Metric label="概算コスト" value={usd.format(value.estimatedCostUsd)} />
          <Metric label="リクエスト" value={number.format(value.requestCount)} />
          <Metric label="入力token" value={number.format(value.inputTokens)} />
          <Metric label="出力token" value={number.format(value.outputTokens)} />
        </dl>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Cloudflare AI Gatewayによる推定値です。
      </p>
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
    <main className="mx-auto min-h-dvh w-full max-w-4xl px-4 py-16 sm:px-8">
      <SkeletonLoader label="統計情報を読み込み中">
        <header className="mb-6">
          <SkeletonBlock className="h-4 w-16 rounded-full" />
          <SkeletonBlock className="mt-3 h-9 w-40 rounded-full" />
          <SkeletonBlock className="mt-3 h-4 w-56 rounded-full" />
        </header>
        <div className="grid gap-5">
          {[
            { key: "gemini", metricKeys: ["cost", "request", "input", "output"] },
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
                className={`mt-4 grid gap-3 ${key === "gemini" ? "grid-cols-2" : "sm:grid-cols-3"}`}
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
      </SkeletonLoader>
    </main>
  );
}

export function AdminStatisticsScreen({
  state,
  isRefreshing = false,
  onReload,
}: { state: AsyncState<AdminStatistics>; isRefreshing?: boolean; onReload: () => void }) {
  if (state.status === "loading" || state.status === "idle") return <StatisticsSkeleton />;
  if (state.status === "error")
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-5 text-center">
        <AlertCircle className="size-10 text-rose-500" />
        <p>{state.message}</p>
        <button
          type="button"
          onClick={onReload}
          className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-900"
        >
          再読み込み
        </button>
      </main>
    );
  const { data } = state;
  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl px-4 py-16 sm:px-8">
      <header className="mb-6">
        <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Admin</p>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">利用統計</h1>
          <button
            type="button"
            onClick={onReload}
            disabled={isRefreshing}
            aria-label={isRefreshing ? "統計情報を更新中" : undefined}
            className="flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
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
      <div className="grid gap-5">
        <Gemini value={data.gemini} />
        <Line value={data.line} />
      </div>
    </main>
  );
}
