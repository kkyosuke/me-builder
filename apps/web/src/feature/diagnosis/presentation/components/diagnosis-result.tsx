import { ArrowLeft, CheckCircle2, ChevronDown, Clock3, Sparkles } from "lucide-react";
import type { AsyncState } from "../../../../model/async-state";
import type { UtsushiProgression } from "../../../profile/model/progression";
import type {
  DiagnosisResult,
  ParameterScore,
  ScoredParameter,
} from "../../model/diagnosis-result";
import {
  getRelationshipCategoryBadgeClassName,
  getRelationshipCategoryLabel,
} from "../../model/relationship-category";
import { getParameterComparisonSummary, getParameterScoreSummary } from "../parameter-summary";

function formatAcceptedAt(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ParameterMeter({
  parameter,
  value,
  perspectiveLabel,
  balancedLabel,
}: {
  parameter: ScoredParameter;
  value: ParameterScore;
  perspectiveLabel?: string;
  balancedLabel: string;
}) {
  const summary = getParameterScoreSummary(value, parameter, balancedLabel);
  const accessibleLabel = perspectiveLabel
    ? `${parameter.label}・${perspectiveLabel}の傾向`
    : `${parameter.label}の傾向`;

  return (
    <div className={perspectiveLabel ? "rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50" : ""}>
      {perspectiveLabel && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {perspectiveLabel}
          </p>
          <p className="ml-auto text-xs font-semibold text-sky-700 dark:text-sky-200">{summary}</p>
        </div>
      )}
      <div
        role="meter"
        aria-label={accessibleLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value.score ?? undefined}
        aria-valuetext={summary}
        className={`relative h-2 rounded-full bg-gradient-to-r from-indigo-400/70 via-slate-300 to-sky-300/70 dark:via-slate-600 ${perspectiveLabel ? "mt-3" : ""}`}
      >
        <span
          className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-slate-600/70 dark:bg-slate-300/70"
          aria-hidden="true"
        />
        {value.score !== null && (
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow dark:border-slate-900"
            style={{ left: `${value.score}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-3 text-[11px] leading-tight text-slate-600 dark:text-slate-400">
        <span>{parameter.lowLabel}</span>
        <span className="text-right">{parameter.highLabel}</span>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">{`回答充足度 ${value.coverage}%`}</p>
    </div>
  );
}

export function DiagnosisResultView({
  result,
  onBack,
  backHref,
  backLabel = "診断一覧",
  progression,
}: {
  result: DiagnosisResult;
  onBack: () => void;
  backHref?: string;
  backLabel?: string;
  progression?: AsyncState<UtsushiProgression>;
}) {
  const isComplete = result.responseStatus === "answered";
  const scoring = isComplete ? result.scoring : null;
  const hasBehaviorDesiredResult = scoring?.parameters.some(
    ({ resultKind }) => resultKind === "behavior_desired",
  );

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-5 sm:px-8 sm:py-8">
      {backHref ? (
        <a
          href={backHref}
          className="mb-5 inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </a>
      ) : (
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </button>
      )}

      <header className="rounded-3xl border border-sky-300/20 bg-white dark:bg-slate-800 p-5 shadow-xl shadow-slate-950/20 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wider text-sky-700 dark:text-sky-300">
              {isComplete ? "回答結果" : "保存済み回答"}
            </p>
            <p
              className={`mt-1 w-fit rounded-full px-2 py-1 text-xs font-semibold ${getRelationshipCategoryBadgeClassName(result.relationshipCategory)}`}
            >
              {getRelationshipCategoryLabel(result.relationshipCategory)}
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50">
              {result.title}
            </h1>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {!isComplete
            ? "回答受付は終了しました。保存済みの回答だけを確認できます。追加回答や結果生成はできません。"
            : scoring
              ? hasBehaviorDesiredResult
                ? "回答から見える普段の行動と、大切にしたいことです。どちら側にも良し悪しはなく、医療的な診断ではありません。"
                : "回答から見える現在の傾向です。どちら側にも良し悪しはなく、医療的な診断ではありません。"
              : "保存した回答内容を確認できます。医療的な診断ではありません。"}
        </p>
        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
          {`${result.answeredCount} / ${result.questionCount}問に回答`}
        </p>
      </header>

      {isComplete && progression && (
        <section
          aria-labelledby="diagnosis-progression-heading"
          className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-800 dark:bg-violet-950/30"
        >
          <h2
            id="diagnosis-progression-heading"
            className="text-sm font-bold text-violet-900 dark:text-violet-100"
          >
            わたしのまとめへの反映
          </h2>
          {progression.status === "idle" ||
          progression.status === "loading" ||
          (progression.status === "success" && progression.data.isProcessing) ? (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              回答から見つかったことを反映しています。
            </p>
          ) : progression.status === "success" ? (
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
              うつし Lv.{progression.data.level}。回答の反映が完了しました。
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              反映は続いています。あとから、わたしのまとめで確認できます。
            </p>
          )}
        </section>
      )}

      {!isComplete ? (
        <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          回答が完了していないため、傾向は生成されません。
        </p>
      ) : scoring ? (
        <section aria-labelledby="profile-heading" className="mt-5">
          <h2
            id="profile-heading"
            className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-50"
          >
            <Sparkles className="size-5 text-sky-700 dark:text-sky-300" aria-hidden="true" />
            回答から見える傾向
          </h2>
          <fieldset
            aria-label="回答から見える傾向の一覧"
            className="mt-3 min-w-0 divide-y divide-slate-200 dark:divide-slate-700 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4"
          >
            {scoring.parameters.map((parameter) => (
              <div key={parameter.id} className="py-3.5">
                {parameter.resultKind === "behavior_desired" ? (
                  <>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {parameter.label}
                    </h3>
                    <div className="mt-3 space-y-2.5">
                      <ParameterMeter
                        parameter={parameter}
                        value={parameter.behavior}
                        perspectiveLabel="普段の行動"
                        balancedLabel={scoring.balancedLabel}
                      />
                      <ParameterMeter
                        parameter={parameter}
                        value={parameter}
                        perspectiveLabel="大切にしたいこと"
                        balancedLabel={scoring.balancedLabel}
                      />
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {getParameterComparisonSummary(parameter)}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {parameter.label}
                      </h3>
                      <p className="text-xs font-semibold text-sky-700 dark:text-sky-200">
                        {getParameterScoreSummary(parameter, parameter, scoring.balancedLabel)}
                      </p>
                    </div>
                    <div className="mt-3">
                      <ParameterMeter
                        parameter={parameter}
                        value={parameter}
                        balancedLabel={scoring.balancedLabel}
                      />
                    </div>
                  </>
                )}
              </div>
            ))}
          </fieldset>
        </section>
      ) : (
        <p className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 text-sm text-slate-700 dark:text-slate-300">
          この診断には、回答から見える傾向がまだ設定されていません。回答内容は確認できます。
        </p>
      )}

      <section aria-label="回答内容" className="mt-7 pb-8">
        <details className="group rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-4 font-bold text-slate-950 dark:text-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400">
            <span>{`回答内容（${result.answers.length}件）`}</span>
            <ChevronDown
              className="size-5 shrink-0 text-slate-600 dark:text-slate-400 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <ol className="space-y-3 border-t border-slate-200 dark:border-slate-700 p-3 sm:p-4">
            {result.answers.map((answer, index) => (
              <li
                key={answer.diagnosisQuestionId}
                className="rounded-xl bg-slate-100/60 dark:bg-slate-900/60 p-4"
              >
                <div className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {answer.perspective !== "single" && (
                      <p className="mb-1 text-[11px] font-semibold text-slate-500">
                        {answer.perspective === "behavior" ? "普段の行動" : "大切にしたいこと"}
                      </p>
                    )}
                    <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                      {answer.questionText}
                    </p>
                    <p className="mt-3 inline-flex rounded-full bg-sky-400/10 px-3 py-1 text-sm font-semibold text-sky-700 dark:text-sky-200">
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
        {isComplete && (
          <a
            href="/me"
            className="mt-5 flex items-center justify-center rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            わたしのまとめを見る
          </a>
        )}
      </section>
    </main>
  );
}
