import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";
import type { DiagnosisDefinition } from "../../model/diagnosis-definition";
import {
  getRelationshipCategoryAnswerContext,
  getRelationshipCategoryBadgeClassName,
  getRelationshipCategoryLabel,
} from "../../model/relationship-category";
import type { DiagnosisAnswer } from "../../model/types";
import { getDiagnosisThumbnail } from "../diagnosis-thumbnail";
import { SwipeDiagnosis } from "./swipe-diagnosis";

function DiagnosisIntroduction({
  diagnosis,
  onStart,
}: {
  diagnosis: DiagnosisDefinition;
  onStart: () => void;
}) {
  return (
    <section
      aria-labelledby="diagnosis-introduction-title"
      className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl shadow-slate-950/15 dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="relative overflow-hidden">
        <img
          src={getDiagnosisThumbnail(diagnosis.id)}
          alt=""
          width="960"
          height="540"
          className="aspect-video w-full object-cover"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/5 to-transparent"
          aria-hidden="true"
        />
        <p
          className={`absolute top-4 left-4 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm ${getRelationshipCategoryBadgeClassName(diagnosis.relationshipCategory)}`}
        >
          {getRelationshipCategoryLabel(diagnosis.relationshipCategory)}
        </p>
        <p className="absolute right-4 bottom-4 rounded-full bg-slate-950/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
          {`全${diagnosis.questions.length}問`}
        </p>
      </div>

      <div className="p-5 sm:p-7">
        <p className="text-xs font-bold tracking-[0.16em] text-sky-700 dark:text-sky-300">
          この診断で見つめること
        </p>
        <h1
          id="diagnosis-introduction-title"
          className="mt-2 text-2xl leading-tight font-bold text-slate-950 dark:text-slate-50 sm:text-3xl"
        >
          {diagnosis.title}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
          {diagnosis.description}
        </p>

        <div className="mt-6 flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/50">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-sky-700 shadow-sm dark:bg-slate-800 dark:text-sky-300">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold tracking-wide text-sky-800 dark:text-sky-200">
              思い浮かべてみてください
            </p>
            <p className="mt-1 text-sm leading-6 font-medium text-slate-800 dark:text-slate-100">
              {getRelationshipCategoryAnswerContext(diagnosis.relationshipCategory)}
            </p>
          </div>
        </div>

        <p className="mt-5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
          正解・不正解はありません。普段のあなたに近い方を選びましょう。
        </p>
        <button
          type="button"
          onClick={onStart}
          className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-400 px-5 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          診断をはじめる
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      </div>
    </section>
  );
}

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
  const [introductionDismissed, setIntroductionDismissed] = useState(false);
  const showIntroduction = initialAnswers.length === 0 && !introductionDismissed;

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

      {showIntroduction ? (
        <DiagnosisIntroduction
          diagnosis={diagnosis}
          onStart={() => setIntroductionDismissed(true)}
        />
      ) : (
        <>
          <p
            className={`mb-3 w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${getRelationshipCategoryBadgeClassName(diagnosis.relationshipCategory)}`}
          >
            {getRelationshipCategoryLabel(diagnosis.relationshipCategory)}
          </p>

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
        </>
      )}
    </main>
  );
}
