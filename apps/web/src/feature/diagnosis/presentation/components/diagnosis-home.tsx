import { ArrowRight, ChevronDown, ClipboardList, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { LoadingState } from "../../../../components/loading-state";
import type { AsyncState } from "../../../../model/async-state";
import type { DiagnosisListItem } from "../../model/diagnosis-list-item";
import { buildDiagnosisListSections } from "../../model/diagnosis-list-sections";

function DiagnosisCard({
  diagnosis,
  onOpenDiagnosis,
}: {
  diagnosis: DiagnosisListItem;
  onOpenDiagnosis: (diagnosis: DiagnosisListItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenDiagnosis(diagnosis)}
      className="group flex min-h-48 flex-col rounded-2xl border border-slate-700 bg-slate-800 p-3 text-left shadow-lg shadow-slate-950/20 transition hover:-translate-y-0.5 hover:border-sky-400/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:p-4"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
        <ClipboardList className="size-4" aria-hidden="true" />
      </span>
      <span className="mt-3 text-base leading-snug font-bold text-slate-50">{diagnosis.title}</span>
      <span className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-400">
        {diagnosis.description}
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className="flex min-h-6 items-center gap-2 text-xs text-slate-500">
          {diagnosis.responseStatus === "in-progress" &&
            `${diagnosis.answeredCount}/${diagnosis.questionCount}`}
          {diagnosis.availability === "closed" && (
            <span className="inline-flex rounded-full bg-amber-400/10 px-2 py-1 font-semibold text-amber-300">
              受付終了
            </span>
          )}
        </span>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-400 text-slate-900 transition group-hover:translate-x-0.5">
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}

function DiagnosisSection({
  id,
  title,
  diagnoses,
  onOpenDiagnosis,
}: {
  id: string;
  title: string;
  diagnoses: DiagnosisListItem[];
  onOpenDiagnosis: (diagnosis: DiagnosisListItem) => void;
}) {
  if (diagnoses.length === 0) return null;

  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-base font-bold text-slate-100">
        {title}
        <span className="ml-2 text-sm font-normal text-slate-500">{diagnoses.length}件</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {diagnoses.map((diagnosis) => (
          <DiagnosisCard
            key={diagnosis.id}
            diagnosis={diagnosis}
            onOpenDiagnosis={onOpenDiagnosis}
          />
        ))}
      </div>
    </section>
  );
}

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
  const [isAnsweredOpen, setIsAnsweredOpen] = useState(false);
  const sections =
    diagnoses.status === "success" ? buildDiagnosisListSections(diagnoses.data) : null;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 sm:px-8">
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-wider text-sky-300">me-builder</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-50">診断</h1>
        <p className="mt-2 text-sm text-slate-400">答えたいカードを選んでください。</p>
      </header>

      <section aria-label="診断一覧" className="space-y-8">
        {diagnoses.status === "error" && (
          <div className="rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center text-sm text-red-300">
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
          <p className="rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400">
            回答できる診断はありません。
          </p>
        )}
        {sections && (
          <>
            <DiagnosisSection
              id="diagnosis-section-in-progress"
              title="回答途中"
              diagnoses={sections.inProgress}
              onOpenDiagnosis={onOpenDiagnosis}
            />
            <DiagnosisSection
              id="diagnosis-section-unanswered"
              title="未回答"
              diagnoses={sections.unanswered}
              onOpenDiagnosis={onOpenDiagnosis}
            />
            {sections.answered.length > 0 && (
              <section aria-labelledby="diagnosis-section-answered">
                <button
                  type="button"
                  aria-expanded={isAnsweredOpen}
                  aria-controls="answered-diagnoses"
                  onClick={() => setIsAnsweredOpen((current) => !current)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-left transition hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  <span id="diagnosis-section-answered" className="font-bold text-slate-100">
                    回答済み
                    <span className="ml-2 text-sm font-normal text-slate-500">
                      {sections.answered.length}件
                    </span>
                  </span>
                  <ChevronDown
                    className={`size-5 text-slate-400 transition-transform ${isAnsweredOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {isAnsweredOpen && (
                  <div id="answered-diagnoses" className="mt-3 grid grid-cols-2 gap-3 sm:gap-4">
                    {sections.answered.map((diagnosis) => (
                      <DiagnosisCard
                        key={diagnosis.id}
                        diagnosis={diagnosis}
                        onOpenDiagnosis={onOpenDiagnosis}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
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
