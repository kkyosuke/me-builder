import {
  ArrowRight,
  BookHeart,
  Brain,
  ClipboardCheck,
  MessageCircleHeart,
  NotebookPen,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { LoadingState } from "../../../components/loading-state";
import { MainNavigation } from "../../../components/main-navigation";
import type { AsyncState } from "../../../model/async-state";
import type {
  ProfileRecordSource,
  ProfileSummary,
  ProfileSummaryResult,
} from "../model/profile-summary";

const sourceLabels: Record<ProfileRecordSource, string> = {
  diagnosis: "診断",
  diary: "日記",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

function SummaryContent({ summary }: { summary: ProfileSummary }) {
  return (
    <>
      <section className="mt-8 overflow-hidden rounded-3xl border border-sky-300/30 bg-gradient-to-br from-sky-50 via-white to-violet-50 p-5 shadow-xl shadow-slate-950/10 sm:p-6 dark:from-sky-950/40 dark:via-slate-800 dark:to-violet-950/30">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-700 dark:text-sky-300">
            <Sparkles className="size-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wider text-sky-700 dark:text-sky-300">
              今のわたし
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-950 dark:text-slate-50">
              {summary.headline}
            </h2>
          </div>
        </div>

        <ol className="mt-5 space-y-3">
          {summary.insights.map((insight, index) => (
            <li key={insight.key} className="rounded-2xl bg-white/80 p-4 dark:bg-slate-900/60">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-sky-500 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <h3 className="font-bold text-slate-950 dark:text-slate-50">{insight.label}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {insight.description}
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <span>根拠</span>
                {insight.sources.map((source) => (
                  <span
                    key={source}
                    className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-700"
                  >
                    {sourceLabels[source]}
                  </span>
                ))}
                <span>{`${insight.evidenceCount}件`}</span>
              </p>
            </li>
          ))}
        </ol>

        <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-200/80 pt-4 text-center dark:border-slate-700">
          <div>
            <dt className="text-xs text-slate-500">診断</dt>
            <dd className="mt-1 font-bold text-slate-900 dark:text-slate-100">
              {summary.diagnosisCount}件
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">日記</dt>
            <dd className="mt-1 font-bold text-slate-900 dark:text-slate-100">
              {summary.diaryCount}件
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">最終記録</dt>
            <dd className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
              {summary.latestRecordedAt ? formatDate(summary.latestRecordedAt) : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        これは記録の範囲から見える現在のまとめです。あなた自身や健康状態を断定するものではなく、記録が変わると内容も変わります。
      </p>

      <section aria-labelledby="sources-heading" className="mt-8">
        <h2
          id="sources-heading"
          className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-50"
        >
          <Brain className="size-5 text-violet-600 dark:text-violet-300" aria-hidden="true" />
          まとめに使ったもの
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <ClipboardCheck className="size-5 text-sky-600 dark:text-sky-300" aria-hidden="true" />
            <p className="mt-3 font-bold text-slate-900 dark:text-slate-100">診断の回答</p>
            <p className="mt-1 text-xs text-slate-500">{summary.diagnosisCount}件を参照</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <NotebookPen
              className="size-5 text-violet-600 dark:text-violet-300"
              aria-hidden="true"
            />
            <p className="mt-3 font-bold text-slate-900 dark:text-slate-100">日記の記録</p>
            <p className="mt-1 text-xs text-slate-500">{summary.diaryCount}件を参照</p>
          </div>
        </div>
      </section>
    </>
  );
}

function EmptySummary() {
  return (
    <section className="mt-8 rounded-3xl border border-sky-300/30 bg-white p-6 text-center shadow-xl shadow-slate-950/10 dark:bg-slate-800">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-700 dark:text-sky-300">
        <Sparkles className="size-7" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-xl font-bold text-slate-950 dark:text-slate-50">
        まだ、わたしのまとめはありません
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        診断に答えたり、LINEのトークで日々のことを話したりすると、あなたらしさが少しずつ見えてきます。
      </p>
      <a
        href="/diagnosis"
        className="mt-5 flex items-center justify-between rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        診断を始める
        <ArrowRight className="size-4" aria-hidden="true" />
      </a>
      <p className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
        <MessageCircleHeart className="size-5" aria-hidden="true" />
        LINEで今日のことを話してみる
      </p>
    </section>
  );
}

function NextAction({ action }: { action: ProfileSummaryResult["nextAction"] }) {
  const needsDiagnosis = action === "diagnosis";
  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-700 dark:text-emerald-300">
          {needsDiagnosis ? (
            <BookHeart className="size-5" aria-hidden="true" />
          ) : (
            <MessageCircleHeart className="size-5" aria-hidden="true" />
          )}
        </span>
        <div>
          <h2 className="font-bold text-slate-950 dark:text-slate-50">これからできること</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            {needsDiagnosis
              ? "まだ答えていない診断があります。回答すると、まとめに新しい一面が加わります。"
              : "診断はすべて回答済みです。毎日の会話で、あなたのことをもう少し教えてください。"}
          </p>
        </div>
      </div>
      {needsDiagnosis && (
        <a
          href="/diagnosis"
          className="mt-4 flex items-center justify-between rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          未回答の診断を見る
          <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      )}
    </section>
  );
}

export function ProfileSummaryScreen({
  state,
  onRetry,
  children,
}: {
  state: AsyncState<ProfileSummaryResult>;
  onRetry: () => void;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 pb-28 sm:px-8">
      <header>
        <p className="text-sm font-semibold tracking-wider text-sky-700 dark:text-sky-300">
          私を知る
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50">
          わたしのまとめ
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          診断と日記の記録をつなげて、今のあなたらしさを振り返ります。
        </p>
      </header>

      {state.status === "loading" && (
        <div className="mt-8">
          <LoadingState variant="panel" message="記録からまとめを作っています..." />
        </div>
      )}
      {state.status === "error" && (
        <section className="mt-8 rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center">
          <p className="text-sm text-red-700 dark:text-red-300">まとめを表示できませんでした。</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {state.message}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-300 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            再試行
          </button>
          <a
            href="/diagnosis"
            className="mt-4 block text-sm font-semibold text-sky-700 underline underline-offset-4 dark:text-sky-300"
          >
            診断一覧を見る
          </a>
        </section>
      )}
      {state.status === "success" && (
        <>
          {state.data.summary ? <SummaryContent summary={state.data.summary} /> : <EmptySummary />}
          {state.data.summary && <NextAction action={state.data.nextAction} />}
        </>
      )}

      {children}

      <MainNavigation current="me" />
    </main>
  );
}
