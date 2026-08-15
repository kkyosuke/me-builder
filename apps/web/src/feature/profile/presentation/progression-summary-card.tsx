import { Layers3, Shapes, Sparkles } from "lucide-react";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import {
  type UtsushiProgression,
  growthUntilNextLevel,
  progressionPercentage,
} from "../model/progression";

const number = new Intl.NumberFormat("ja-JP");

function ProgressionCard({ progression }: { progression: UtsushiProgression }) {
  const percentage = progressionPercentage(progression);
  const remaining = growthUntilNextLevel(progression);

  return (
    <section
      aria-labelledby="utsushi-level-heading"
      className="mt-6 overflow-hidden rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-sky-50 shadow-sm dark:border-violet-800/60 dark:from-violet-950/50 dark:via-slate-800 dark:to-sky-950/40"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
              <Sparkles className="size-4" aria-hidden="true" />
              これまでの歩み
            </p>
            <h2
              id="utsushi-level-heading"
              className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-50"
            >
              うつし <span className="tabular-nums">Lv.{number.format(progression.level)}</span>
            </h2>
          </div>
          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm dark:bg-slate-900/60 dark:text-slate-300">
            上限なく育ちます
          </span>
        </div>

        <div className="mt-5">
          <progress
            aria-label={`うつしレベル${progression.level}の進み具合`}
            max={progression.nextLevelThreshold - progression.currentLevelThreshold}
            value={
              Math.min(
                progression.nextLevelThreshold,
                Math.max(progression.currentLevelThreshold, progression.growthValue),
              ) - progression.currentLevelThreshold
            }
            className="sr-only"
          />
          <div
            aria-hidden="true"
            data-progress-value={Math.min(
              progression.nextLevelThreshold,
              Math.max(progression.currentLevelThreshold, progression.growthValue),
            )}
            className="h-2.5 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-400"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="mt-2 text-right text-xs font-medium text-slate-600 dark:text-slate-300">
            次のレベルまで、あと
            <span className="ml-1 font-bold tabular-nums">{number.format(remaining)}</span>
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 border-t border-violet-200/70 bg-white/55 dark:border-violet-800/60 dark:bg-slate-900/25">
        <div className="border-r border-violet-200/70 p-4 dark:border-violet-800/60">
          <dt className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Layers3 className="size-4 text-violet-500" aria-hidden="true" />
            わたしのかけら
          </dt>
          <dd className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span>
              集めた
              <strong className="ml-1 text-lg tabular-nums text-slate-950 dark:text-slate-50">
                {number.format(progression.collectedPieces)}
              </strong>
              個
            </span>
            <span className="text-slate-600 dark:text-slate-300">
              有効
              <strong className="ml-1 tabular-nums text-slate-900 dark:text-slate-100">
                {number.format(progression.activePieces)}
              </strong>
              個
            </span>
          </dd>
        </div>
        <div className="p-4">
          <dt className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Shapes className="size-4 text-sky-500" aria-hidden="true" />
            分類の広がり
          </dt>
          <dd className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            <strong className="text-lg tabular-nums text-slate-950 dark:text-slate-50">
              {number.format(progression.categoryCount)}
            </strong>
            種類
          </dd>
        </div>
      </dl>

      <p className="border-t border-violet-200/70 px-5 py-3 text-xs leading-relaxed text-slate-500 dark:border-violet-800/60 dark:text-slate-400">
        このレベルは優劣や完成度ではなく、自分への理解が育った歩みです。
      </p>
    </section>
  );
}

function ProgressionSkeleton() {
  return (
    <SkeletonLoader label="うつしレベルを読み込み中" className="mt-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <SkeletonBlock className="h-3 w-24 rounded-full" />
        <SkeletonBlock className="mt-3 h-8 w-36 rounded-full" />
        <SkeletonBlock className="mt-6 h-2.5 w-full rounded-full" />
        <div className="mt-6 grid grid-cols-2 gap-4">
          <SkeletonBlock className="h-16 rounded-2xl" />
          <SkeletonBlock className="h-16 rounded-2xl" />
        </div>
      </section>
    </SkeletonLoader>
  );
}

export function ProgressionSummaryCard({ state }: { state: AsyncState<UtsushiProgression> }) {
  if (state.status === "idle" || state.status === "loading") return <ProgressionSkeleton />;
  if (state.status === "error") {
    return (
      <output className="mt-6 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        うつしレベルを表示できませんでした。診断や記録はそのまま続けられます。
      </output>
    );
  }
  return <ProgressionCard progression={state.data} />;
}
