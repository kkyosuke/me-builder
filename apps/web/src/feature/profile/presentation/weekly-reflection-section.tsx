import { CalendarHeart, LoaderCircle, RefreshCw } from "lucide-react";
import type { AsyncState } from "../../../model/async-state";
import type { WeeklyReflectionResult } from "../model/weekly-reflection";

export function WeeklyReflectionSection({
  state,
  onGenerate,
}: {
  state: AsyncState<WeeklyReflectionResult>;
  onGenerate: () => void;
}) {
  if (state.status === "loading" || state.status === "idle") {
    return <p className="mt-8 text-sm text-slate-500">今週の振り返りを読み込んでいます…</p>;
  }
  if (state.status === "error") {
    return <p className="mt-8 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{state.message}</p>;
  }
  const current = state.data.reflections[0];
  const processing =
    state.data.generation.status === "queued" || state.data.generation.status === "generating";
  return (
    <section className="mt-8" aria-labelledby="weekly-reflection-title">
      <div className="flex items-center gap-2">
        <CalendarHeart className="size-5 text-indigo-500" aria-hidden="true" />
        <h2 id="weekly-reflection-title" className="font-semibold">
          今週の振り返り
        </h2>
      </div>
      {current ? (
        <article className="mt-3 rounded-3xl border border-indigo-100 bg-indigo-50/60 p-5 dark:border-indigo-900 dark:bg-indigo-950/30">
          <p className="text-xs text-slate-500">{current.weekStart} の週</p>
          <h3 className="mt-1 font-semibold">{current.headline}</h3>
          <div className="mt-4 space-y-3">
            {current.items.map((item) => (
              <div
                key={`${item.kind}-${item.title}`}
                className="rounded-2xl bg-white/80 p-4 dark:bg-slate-900/70"
              >
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {item.description}
                </p>
                <p className="mt-2 text-xs text-slate-400">確認した記録 {item.evidenceCount}件</p>
              </div>
            ))}
          </div>
        </article>
      ) : (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          診断や日記から、今週の出来事と次の小さな一歩を最大3項目で整理します。
        </p>
      )}
      {state.data.generation.message ? (
        <p className="mt-3 text-sm text-rose-600">{state.data.generation.message}</p>
      ) : null}
      <button
        type="button"
        onClick={onGenerate}
        disabled={!state.data.canStartNew || !state.data.generation.canGenerate || processing}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {processing ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        {state.data.generation.status === "failed" ? "もう一度作る" : "今週の振り返りを作る"}
      </button>
      {!state.data.canStartNew ? (
        <p className="mt-2 text-xs text-slate-500">
          Freeでは過去の振り返りを閲覧できます。新しい生成はLite以上で利用できます。
        </p>
      ) : null}
      {state.data.generation.notification === "skipped" ? (
        <p className="mt-2 text-xs text-slate-500">
          通知を停止しているため、完成通知は送信しません。
        </p>
      ) : null}
    </section>
  );
}
