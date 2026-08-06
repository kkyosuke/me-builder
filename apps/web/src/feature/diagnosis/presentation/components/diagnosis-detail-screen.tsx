import { ArrowLeft } from "lucide-react";
import type { DiagnosisDefinition } from "../../model/diagnosis-definition";
import type { DiagnosisAnswer } from "../../model/types";
import { SwipeDiagnosis } from "./swipe-diagnosis";

export function DiagnosisDetailScreen({
  diagnosis,
  initialAnswers,
  onBack,
  onSaveAnswer,
  onDeferQuestion,
  onComplete,
}: {
  diagnosis: DiagnosisDefinition;
  initialAnswers: DiagnosisAnswer[];
  onBack: () => void;
  onSaveAnswer: Parameters<typeof SwipeDiagnosis>[0]["onSaveAnswer"];
  onDeferQuestion: Parameters<typeof SwipeDiagnosis>[0]["onDeferQuestion"];
  onComplete: Parameters<typeof SwipeDiagnosis>[0]["onComplete"];
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-5 sm:px-8 sm:py-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-950 dark:hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        診断一覧
      </button>

      <p className="mb-4 rounded-2xl border border-sky-300/30 bg-sky-300/10 px-4 py-3 text-sm leading-relaxed text-sky-800 dark:text-sky-100">
        回答は1問ずつ保存されます。保存に失敗した場合は、選択を保ったまま再試行できます。
      </p>
      <SwipeDiagnosis
        diagnosis={diagnosis}
        initialAnswers={initialAnswers}
        onBack={onBack}
        onSaveAnswer={onSaveAnswer}
        onDeferQuestion={onDeferQuestion}
        onComplete={onComplete}
      />
    </main>
  );
}
