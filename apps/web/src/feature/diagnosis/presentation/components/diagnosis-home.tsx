import { ArrowRight, ChevronDown, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { MainNavigation } from "../../../../components/main-navigation";
import type { AsyncState } from "../../../../model/async-state";
import type { DiagnosisListItem } from "../../model/diagnosis-list-item";
import { buildDiagnosisListSections } from "../../model/diagnosis-list-sections";
import { DiagnosisListSkeleton } from "./diagnosis-loading-skeleton";

const diagnosisThumbnails: Record<string, string> = {
  "relationship-priority": "/images/diagnoses/relationship-priority.jpg",
  "money-values": "/images/diagnoses/money-values.jpg",
  "leisure-style": "/images/diagnoses/leisure-style.jpg",
  "time-planning": "/images/diagnoses/time-planning.jpg",
  "conversation-emotion": "/images/diagnoses/conversation-emotion.jpg",
};

function getDiagnosisThumbnail(diagnosisId: string) {
  return diagnosisThumbnails[diagnosisId] ?? "/images/diagnoses/default.jpg";
}

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
      className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-lg shadow-slate-950/20 transition hover:-translate-y-0.5 hover:border-sky-400/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:border-slate-700 dark:bg-slate-800"
    >
      <img
        src={getDiagnosisThumbnail(diagnosis.id)}
        alt=""
        width="960"
        height="540"
        loading="lazy"
        className="aspect-video w-full object-cover"
      />
      <span className="flex flex-1 flex-col p-3">
        <span className="line-clamp-2 text-sm leading-snug font-bold text-slate-950 sm:text-base dark:text-slate-50">
          {diagnosis.title}
        </span>
        <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          {diagnosis.description}
        </span>
        <span className="mt-auto flex items-center justify-between gap-2 pt-2.5">
          <span className="flex min-h-6 items-center gap-2 text-xs text-slate-500">
            {diagnosis.responseStatus === "in-progress" &&
              `${diagnosis.answeredCount}/${diagnosis.questionCount}`}
            {diagnosis.availability === "closed" && (
              <span className="inline-flex rounded-full bg-amber-400/10 px-2 py-1 font-semibold text-amber-700 dark:text-amber-300">
                受付終了
              </span>
            )}
          </span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-400 text-slate-900 transition group-hover:translate-x-0.5">
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </span>
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
      <h2 id={id} className="mb-3 text-base font-bold text-slate-900 dark:text-slate-100">
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
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 pb-28 sm:px-8">
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-wider text-sky-700 dark:text-sky-300">
          私をひもとく
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50">わたしの診断</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          答えたいカードを選んでください。
        </p>
      </header>

      <section aria-label="診断一覧" className="space-y-8">
        {diagnoses.status === "error" && (
          <div className="rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center text-sm text-red-700 dark:text-red-300">
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
        {diagnoses.status === "loading" && <DiagnosisListSkeleton />}
        {diagnoses.status === "success" && diagnoses.data.length === 0 && (
          <p className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-center text-sm text-slate-600 dark:text-slate-400">
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
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 px-4 py-3 text-left transition hover:border-slate-300 dark:hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  <span
                    id="diagnosis-section-answered"
                    className="font-bold text-slate-900 dark:text-slate-100"
                  >
                    回答済み
                    <span className="ml-2 text-sm font-normal text-slate-500">
                      {sections.answered.length}件
                    </span>
                  </span>
                  <ChevronDown
                    className={`size-5 text-slate-600 dark:text-slate-400 transition-transform ${isAnsweredOpen ? "rotate-180" : ""}`}
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
          <p className="text-xs font-semibold tracking-wider text-rose-700 dark:text-rose-300">
            DEV ONLY
          </p>
          <h2
            id="development-tools-heading"
            className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100"
          >
            開発用データ操作
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            ログイン中ユーザーの回答、回答進捗、保留、回答由来Source Record、診断から生成されたBrain
            Itemを削除します。診断定義と日記由来データは残ります。
          </p>
          <button
            type="button"
            onClick={onResetDiagnosisData}
            disabled={resetState.status === "loading"}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/40 px-4 py-2 text-sm font-semibold text-rose-700 dark:text-rose-200 transition hover:bg-rose-400/10 disabled:cursor-wait disabled:opacity-60"
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
              className={`mt-3 block text-xs ${
                resetState.status === "success"
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-rose-700 dark:text-rose-300"
              }`}
            >
              {resetState.status === "success" ? resetState.data : resetState.message}
            </output>
          )}
        </section>
      )}
      <MainNavigation current="diagnosis" />
    </main>
  );
}
