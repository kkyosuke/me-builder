import { ArrowRight, ChevronDown, RotateCw } from "lucide-react";
import { MainNavigation } from "../../../../components/main-navigation";
import type { AsyncState } from "../../../../model/async-state";
import type { DiagnosisListItem } from "../../model/diagnosis-list-item";
import { buildDiagnosisListSections } from "../../model/diagnosis-list-sections";
import {
  type RelationshipCategoryFilter,
  filterDiagnosesByRelationshipCategory,
  filterableRelationshipCategoryValues,
  getRelationshipCategoryBadgeClassName,
  getRelationshipCategoryFilterClassName,
  getRelationshipCategoryLabel,
} from "../../model/relationship-category";
import { getDiagnosisThumbnail } from "../diagnosis-thumbnail";
import { DiagnosisListSkeleton } from "./diagnosis-loading-skeleton";

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
        <span
          className={`mb-2 w-fit rounded-full px-2 py-1 text-[0.6875rem] leading-none font-semibold ${getRelationshipCategoryBadgeClassName(diagnosis.relationshipCategory)}`}
        >
          {getRelationshipCategoryLabel(diagnosis.relationshipCategory)}
        </span>
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
  categoryFilter,
  diagnoses,
  isAnsweredOpen,
  onAnsweredOpenChange,
  onCategoryFilterChange,
  onOpenDiagnosis,
  onRetry,
  progressionLevel,
}: {
  categoryFilter: RelationshipCategoryFilter;
  diagnoses: AsyncState<DiagnosisListItem[]>;
  isAnsweredOpen: boolean;
  onAnsweredOpenChange: (isOpen: boolean) => void;
  onCategoryFilterChange: (filter: RelationshipCategoryFilter) => void;
  onOpenDiagnosis: (diagnosis: DiagnosisListItem) => void;
  onRetry: () => void;
  progressionLevel?: number;
}) {
  const filteredDiagnoses =
    diagnoses.status === "success"
      ? filterDiagnosesByRelationshipCategory(diagnoses.data, categoryFilter)
      : [];
  const sections =
    diagnoses.status === "success" ? buildDiagnosisListSections(filteredDiagnoses) : null;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 pb-28 sm:px-8">
      <header className="mb-8">
        <div className="flex items-center justify-between gap-3 pr-14 sm:pr-0">
          <p className="text-sm font-semibold tracking-wider text-sky-700 dark:text-sky-300">
            私をひもとく
          </p>
          {progressionLevel !== undefined && (
            <a
              href="/me"
              aria-label={`うつしレベル${progressionLevel}、わたしのまとめを見る`}
              className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold tabular-nums text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-violet-950 dark:text-violet-300"
            >
              うつし Lv.{progressionLevel}
            </a>
          )}
        </div>
        <h1
          tabIndex={-1}
          data-main-route-heading="diagnosis"
          className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50 focus:outline-none"
        >
          わたしの診断
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          答えたいカードを選んでください。
        </p>
      </header>

      {diagnoses.status === "success" && diagnoses.data.length > 0 && (
        <fieldset className="-mx-4 mb-7 flex min-w-0 gap-2 overflow-x-auto border-0 px-4 pt-0 pb-1 sm:mx-0 sm:px-0">
          <legend className="sr-only">関係カテゴリで絞り込む</legend>
          <button
            type="button"
            aria-pressed={categoryFilter === "all"}
            onClick={() => onCategoryFilterChange("all")}
            className="shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 aria-pressed:border-sky-500 aria-pressed:bg-sky-100 aria-pressed:text-sky-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:aria-pressed:border-sky-500 dark:aria-pressed:bg-sky-950 dark:aria-pressed:text-sky-100"
          >
            全部
          </button>
          {filterableRelationshipCategoryValues.map((category) => (
            <button
              type="button"
              key={category}
              aria-pressed={categoryFilter === category}
              onClick={() => onCategoryFilterChange(category)}
              className={`shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 ${getRelationshipCategoryFilterClassName(category)}`}
            >
              {getRelationshipCategoryLabel(category)}
            </button>
          ))}
        </fieldset>
      )}

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
        {diagnoses.status === "success" &&
          diagnoses.data.length > 0 &&
          filteredDiagnoses.length === 0 && (
            <p className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              このカテゴリの診断はありません。
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
                  onClick={() => onAnsweredOpenChange(!isAnsweredOpen)}
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

      <MainNavigation current="diagnosis" />
    </main>
  );
}
