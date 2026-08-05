import { ArrowRight, ClipboardList, RotateCw, Trash2 } from "lucide-react";
import { LoadingState } from "../../../../components/loading-state";
import type { AsyncState } from "../../../../model/async-state";
import type { DiagnosisListItem } from "../../model/diagnosis-list-item";

const STATUS_LABELS: Record<DiagnosisListItem["responseStatus"], string> = {
  unanswered: "未回答",
  "in-progress": "回答途中",
  answered: "回答済み",
};

export function DiagnosisHome({
  diagnoses,
  onOpenDiagnosis,
  onRetry,
  canResetDiagnosisData,
  resetState,
  onResetDiagnosisData,
}: {
  diagnoses: AsyncState<DiagnosisListItem[]>;
  onOpenDiagnosis: (diagnosis: DiagnosisListItem) => void;
  onRetry: () => void;
  canResetDiagnosisData: boolean;
  resetState: AsyncState<string>;
  onResetDiagnosisData: () => void;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 sm:px-8">
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-wider text-sky-300">me-builder</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-50">診断</h1>
        <p className="mt-2 text-sm text-slate-400">答えたいカードを選んでください。</p>
      </header>

      <section aria-label="診断一覧" className="grid grid-cols-2 gap-3 sm:gap-4">
        {diagnoses.status === "error" && (
          <div className="col-span-full rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center text-sm text-red-300">
            <p>{`診断を読み込めませんでした: ${diagnoses.message}`}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-red-300 px-4 py-2 font-semibold text-slate-950 transition hover:bg-red-200"
            >
              <RotateCw className="size-4" aria-hidden="true" />
              再試行
            </button>
          </div>
        )}
        {diagnoses.status === "loading" && (
          <LoadingState variant="panel" message="診断を読み込んでいます..." />
        )}
        {diagnoses.status === "success" && diagnoses.data.length === 0 && (
          <p className="col-span-full rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400">
            回答できる診断はありません。
          </p>
        )}
        {diagnoses.status === "success" &&
          diagnoses.data.map((diagnosis) => (
            <button
              key={diagnosis.id}
              type="button"
              onClick={() => onOpenDiagnosis(diagnosis)}
              className="group flex min-h-64 flex-col rounded-3xl border border-slate-700 bg-slate-800 p-4 text-left shadow-xl shadow-slate-950/20 transition hover:-translate-y-1 hover:border-sky-400/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:p-5"
            >
              <span className="flex size-11 items-center justify-center rounded-2xl bg-sky-400/10 text-sky-300">
                <ClipboardList className="size-5" aria-hidden="true" />
              </span>
              <span className="mt-5 text-lg leading-snug font-bold text-slate-50">
                {diagnosis.title}
              </span>
              <span className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-400 sm:text-sm">
                {diagnosis.description}
              </span>
              <span className="mt-auto flex items-end justify-between gap-2 pt-5">
                <span>
                  <span className="block text-xs text-slate-500">
                    {diagnosis.responseStatus === "in-progress"
                      ? `${diagnosis.answeredCount} / ${diagnosis.questionCount}問`
                      : `${diagnosis.questionCount}問`}
                  </span>
                  <span className="mt-1 inline-flex rounded-full bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-300">
                    {diagnosis.availability === "closed"
                      ? "受付終了"
                      : STATUS_LABELS[diagnosis.responseStatus]}
                  </span>
                </span>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-400 text-slate-900 transition group-hover:translate-x-0.5">
                  <ArrowRight className="size-4" aria-hidden="true" />
                </span>
              </span>
            </button>
          ))}
      </section>

      {canResetDiagnosisData && (
        <section
          aria-labelledby="development-tools-heading"
          className="mt-8 rounded-2xl border border-dashed border-rose-400/30 bg-rose-400/5 p-4"
        >
          <p className="text-xs font-semibold tracking-wider text-rose-300">DEV ONLY</p>
          <h2 id="development-tools-heading" className="mt-1 text-sm font-bold text-slate-100">
            開発用データ操作
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            ログイン中ユーザーの回答、回答進捗、保留、回答由来データを削除します。診断定義は残ります。
          </p>
          <button
            type="button"
            onClick={onResetDiagnosisData}
            disabled={resetState.status === "loading"}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/40 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/10 disabled:cursor-wait disabled:opacity-60"
          >
            {resetState.status === "loading" ? (
              <RotateCw
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
            {resetState.status === "loading" ? "削除しています..." : "回答データを全削除"}
          </button>
          {(resetState.status === "success" || resetState.status === "error") && (
            <output
              className={`mt-3 block text-xs ${resetState.status === "success" ? "text-emerald-300" : "text-rose-300"}`}
            >
              {resetState.status === "success" ? resetState.data : resetState.message}
            </output>
          )}
        </section>
      )}
    </main>
  );
}
