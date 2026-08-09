import {
  ArrowRight,
  BookHeart,
  BookOpenText,
  Brain,
  ClipboardCheck,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { LoadingState } from "../../../components/loading-state";
import { MainNavigation } from "../../../components/main-navigation";
import type { AsyncState } from "../../../model/async-state";
import type {
  ProfileParameter,
  ProfileRecordSource,
  ProfileSummary,
  ProfileSummaryResult,
} from "../model/profile-summary";

const sourceLabels: Record<ProfileRecordSource, string> = {
  diagnosis: "診断",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

function parameterSummary(parameter: ProfileParameter, balancedLabel: string): string {
  if (parameter.band === "insufficient") return "回答が増えると表示できます";
  if (parameter.band === "low") return parameter.lowLabel;
  if (parameter.band === "high") return parameter.highLabel;
  return balancedLabel;
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

        <dl className="mt-5 grid grid-cols-2 gap-2 border-t border-slate-200/80 pt-4 text-center sm:grid-cols-4 dark:border-slate-700">
          <div>
            <dt className="text-xs text-slate-500">日記</dt>
            <dd className="mt-1 font-bold text-slate-900 dark:text-slate-100">
              {summary.diaryCount}件
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">診断</dt>
            <dd className="mt-1 font-bold text-slate-900 dark:text-slate-100">
              {summary.diagnosisCount}件
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">回答</dt>
            <dd className="mt-1 font-bold text-slate-900 dark:text-slate-100">
              {summary.recordCount}件
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

      {summary.themes.length > 0 && (
        <section aria-labelledby="themes-heading" className="mt-8">
          <h2
            id="themes-heading"
            className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-50"
          >
            <Brain className="size-5 text-violet-600 dark:text-violet-300" aria-hidden="true" />
            テーマごとの傾向
          </h2>
          <div className="mt-3 space-y-4">
            {summary.themes.map((theme) => (
              <article
                key={theme.diagnosisId}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex items-start gap-3">
                  <ClipboardCheck
                    className="mt-0.5 size-5 shrink-0 text-sky-600 dark:text-sky-300"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100">{theme.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {`${theme.answerCount}回答・最終回答 ${formatDate(theme.lastAnsweredAt)}`}
                    </p>
                  </div>
                </div>

                {theme.scoring ? (
                  <div className="mt-4 space-y-4">
                    {theme.scoring.parameters.map((parameter) => {
                      const summaryText = parameterSummary(
                        parameter,
                        theme.scoring?.balancedLabel ?? "状況による",
                      );
                      return (
                        <div key={parameter.id}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                              {parameter.label}
                            </p>
                            <p className="text-right text-xs text-sky-700 dark:text-sky-300">
                              {summaryText}
                            </p>
                          </div>
                          <div
                            role="meter"
                            aria-label={`${parameter.label}の傾向`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={parameter.score ?? undefined}
                            aria-valuetext={summaryText}
                            className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-indigo-400/70 via-slate-300 to-sky-300/70 dark:via-slate-600"
                          >
                            {parameter.score !== null && (
                              <span
                                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-600 shadow dark:border-slate-900"
                                style={{ left: `${parameter.score}%` }}
                                aria-hidden="true"
                              />
                            )}
                          </div>
                          <div className="mt-1 flex justify-between gap-3 text-[11px] text-slate-500">
                            <span>{parameter.lowLabel}</span>
                            <span className="text-right">{parameter.highLabel}</span>
                          </div>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {`回答充足度 ${parameter.coverage}%・根拠 ${parameter.evidenceCount}回答`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                    回答は保存されていますが、この診断の傾向はまだ設定されていません。
                  </p>
                )}

                <a
                  href={`/diagnosis?result=${encodeURIComponent(theme.diagnosisId)}&from=profile`}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-sky-700 underline underline-offset-4 dark:text-sky-300"
                >
                  回答結果を見る
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </article>
            ))}
          </div>
        </section>
      )}

      {summary.diaryMemories.length > 0 && (
        <section aria-labelledby="diary-memories-heading" className="mt-8">
          <h2
            id="diary-memories-heading"
            className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-50"
          >
            <BookOpenText
              className="size-5 text-emerald-600 dark:text-emerald-300"
              aria-hidden="true"
            />
            日記からの記録
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            日記で話した出来事からAIが抽出した記録です。人物像を推定したものではありません。
          </p>
          <ol className="mt-3 space-y-3">
            {summary.diaryMemories.map((memory) => (
              <li
                key={memory.id}
                className="rounded-2xl border border-emerald-200 bg-white p-4 dark:border-emerald-900/60 dark:bg-slate-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    日記・AI抽出
                  </span>
                  <time dateTime={memory.recordedAt} className="text-xs text-slate-500">
                    {formatDate(memory.recordedAt)}
                  </time>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                  {memory.statement}
                </p>
                <p className="mt-2 text-xs text-slate-500">{`根拠 ${memory.evidenceCount}発言`}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
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
        診断に答えると、回答した範囲から現在の傾向を振り返れます。
      </p>
      <a
        href="/diagnosis"
        className="mt-5 flex items-center justify-between rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        診断を始める
        <ArrowRight className="size-4" aria-hidden="true" />
      </a>
    </section>
  );
}

function NextAction() {
  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-700 dark:text-emerald-300">
          <BookHeart className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-bold text-slate-950 dark:text-slate-50">これからできること</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            まだ答えていない診断があります。回答すると、まとめに新しい一面が加わります。
          </p>
        </div>
      </div>
      <a
        href="/diagnosis"
        className="mt-4 flex items-center justify-between rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        未回答の診断を見る
        <ArrowRight className="size-4" aria-hidden="true" />
      </a>
    </section>
  );
}

export function ProfileSummaryScreen({
  state,
  onRetry,
}: {
  state: AsyncState<ProfileSummaryResult>;
  onRetry: () => void;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 pb-28 sm:px-8">
      <header>
        <p className="text-sm font-semibold tracking-wider text-sky-700 dark:text-sky-300">
          私を知る
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50">わたしの傾向</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          これまでの診断回答と日記から見える、今のあなたです。
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
          {state.data.summary && state.data.nextAction && <NextAction />}
        </>
      )}

      <MainNavigation current="me" />
    </main>
  );
}
