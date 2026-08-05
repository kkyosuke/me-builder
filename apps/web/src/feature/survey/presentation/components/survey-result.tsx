import { ArrowLeft, CheckCircle2, ChevronDown, Clock3, Sparkles } from "lucide-react";
import { getParameterSummary } from "../../model/scoring";
import type { SurveyResult } from "../../model/survey-result";

function formatAcceptedAt(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function SurveyResultView({
  result,
  onBack,
}: {
  result: SurveyResult;
  onBack: () => void;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-5 sm:px-8 sm:py-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        アンケート一覧
      </button>

      <header className="rounded-3xl border border-sky-300/20 bg-slate-800 p-5 shadow-xl shadow-slate-950/20 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300">
            <CheckCircle2 className="size-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wider text-sky-300">回答結果</p>
            <h1 className="mt-1 text-xl font-bold text-slate-50">{result.title}</h1>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-300">
          回答から見える現在の傾向です。どちら側にも良し悪しはなく、医療的な診断ではありません。
        </p>
        <p className="mt-3 text-xs text-slate-400">
          {`${result.answeredCount} / ${result.questionCount}問に回答`}
        </p>
      </header>

      <section aria-labelledby="profile-heading" className="mt-5">
        <h2
          id="profile-heading"
          className="flex items-center gap-2 text-lg font-bold text-slate-50"
        >
          <Sparkles className="size-5 text-sky-300" aria-hidden="true" />
          回答から見える傾向
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {result.profile.parameters.map((parameter) => (
            <article
              key={parameter.id}
              className="rounded-2xl border border-slate-700 bg-slate-800 p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-200">{parameter.label}</h3>
                <p className="font-bold text-sky-300">
                  {parameter.score === null ? "—" : parameter.score}
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-sky-300"
                  style={{ width: `${parameter.score ?? 0}%` }}
                />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-100">
                {getParameterSummary(parameter, result.balancedLabel)}
              </p>
              <p className="mt-1 text-xs text-slate-500">{`回答充足度 ${parameter.coverage}%`}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-label="回答内容" className="mt-7 pb-8">
        <details className="group rounded-2xl border border-slate-700 bg-slate-800">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-4 font-bold text-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400">
            <span>{`回答内容（${result.answers.length}件）`}</span>
            <ChevronDown
              className="size-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <ol className="space-y-3 border-t border-slate-700 p-3 sm:p-4">
            {result.answers.map((answer, index) => (
              <li key={answer.surveyQuestionId} className="rounded-xl bg-slate-900/60 p-4">
                <div className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-slate-300">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-slate-200">{answer.questionText}</p>
                    <p className="mt-3 inline-flex rounded-full bg-sky-400/10 px-3 py-1 text-sm font-semibold text-sky-200">
                      {answer.choiceLabel}
                    </p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                      <Clock3 className="size-3.5" aria-hidden="true" />
                      <time dateTime={answer.acceptedAt}>
                        {formatAcceptedAt(answer.acceptedAt)}
                      </time>
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </details>
      </section>
    </main>
  );
}
