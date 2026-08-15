import { Download, Layers3, Shapes, Sparkles } from "lucide-react";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import {
  type UtsushiProgression,
  growthUntilNextLevel,
  progressionPercentage,
} from "../model/progression";
import type { UtsushiMilestoneCard } from "../model/progression";

const number = new Intl.NumberFormat("ja-JP");

const changeLabels = {
  new_piece: "新しいかけらが見つかりました",
  evidence_deepened: "かけらの根拠が深まりました",
  temporal_change: "今の自分へ更新されました",
} as const;

const categoryLabels: Readonly<Record<string, string>> = {
  identity: "自分らしさ",
  memory: "思い出",
  behavior_pattern: "行動パターン",
  value_motivation: "価値観",
  decision_system: "判断のしかた",
  preference: "好み",
  goal: "目標",
};

function categoryLabel(category: string): string {
  return categoryLabels[category] ?? category;
}

function reachedDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => {
    const replacements: Readonly<Record<string, string>> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return replacements[character] ?? character;
  });
}

function downloadMilestoneCard(card: UtsushiMilestoneCard): void {
  const categories = card.categories.map(categoryLabel).join("・") || "これまでの歩み";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ede9fe"/><stop offset="0.55" stop-color="#ffffff"/><stop offset="1" stop-color="#e0f2fe"/></linearGradient></defs><rect width="1200" height="630" rx="48" fill="url(#bg)"/><rect x="32" y="32" width="1136" height="566" rx="36" fill="none" stroke="#8b5cf6" stroke-width="4"/><text x="90" y="130" font-family="sans-serif" font-size="34" font-weight="700" fill="#6d28d9">うつし 成長カード</text><text x="90" y="285" font-family="sans-serif" font-size="100" font-weight="800" fill="#0f172a">Lv.${card.level}</text><text x="95" y="360" font-family="sans-serif" font-size="30" fill="#334155">${escapeXml(reachedDate(card.reachedAt))}</text><text x="95" y="440" font-family="sans-serif" font-size="34" font-weight="700" fill="#0f172a">前の節目から かけら +${card.collectedPiecesDelta}</text><text x="95" y="510" font-family="sans-serif" font-size="27" fill="#475569">${escapeXml(categories)}</text><text x="95" y="565" font-family="sans-serif" font-size="22" fill="#64748b">自分への理解が育った歩み</text></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `utsushi-level-${card.level}.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
}

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

      {progression.recentChanges.length > 0 && (
        <section
          aria-labelledby="recent-growth-heading"
          className="border-t border-violet-200/70 px-5 py-4 dark:border-violet-800/60"
        >
          <h3
            id="recent-growth-heading"
            className="text-xs font-semibold text-slate-600 dark:text-slate-300"
          >
            最近育ったこと
          </h3>
          <ul className="mt-2 space-y-2">
            {progression.recentChanges.map((change) => (
              <li
                key={`${change.kind}:${change.occurredAt}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-slate-700 dark:text-slate-200">
                  {changeLabels[change.kind]}
                </span>
                <strong className="shrink-0 tabular-nums text-violet-700 dark:text-violet-300">
                  +{number.format(change.growthDelta)}
                </strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {progression.milestoneCards.length > 0 && (
        <section
          aria-labelledby="milestone-card-heading"
          className="border-t border-violet-200/70 p-5 dark:border-violet-800/60"
        >
          <h3
            id="milestone-card-heading"
            className="text-sm font-bold text-slate-900 dark:text-slate-100"
          >
            10レベルごとの成長カード
          </h3>
          <div className="mt-3 space-y-3">
            {progression.milestoneCards.map((card) => (
              <article
                key={card.level}
                className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-100 via-white to-sky-100 p-4 dark:border-violet-800 dark:from-violet-950 dark:via-slate-900 dark:to-sky-950"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                      {reachedDate(card.reachedAt)} 到達
                    </p>
                    <p className="mt-1 text-3xl font-black tabular-nums text-slate-950 dark:text-slate-50">
                      Lv.{number.format(card.level)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadMilestoneCard(card)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-violet-700 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-slate-800 dark:text-violet-300"
                  >
                    <Download className="size-4" aria-hidden="true" />
                    保存
                  </button>
                </div>
                <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
                  前の節目から、かけらが
                  <strong className="mx-1 tabular-nums">
                    +{number.format(card.collectedPiecesDelta)}
                  </strong>
                  個
                </p>
                {card.categories.length > 0 && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    広がった分類: {card.categories.map(categoryLabel).join("・")}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <p className="border-t border-violet-200/70 px-5 py-3 text-xs leading-relaxed text-slate-500 dark:border-violet-800/60 dark:text-slate-400">
        このレベルは優劣や完成度ではなく、自分への理解が育った歩みです。
      </p>
    </section>
  );
}

function ProgressionSkeleton() {
  return (
    <SkeletonLoader label="うつしレベルを読み込み中" className="mt-6">
      <section
        data-skeleton-region="progression-card"
        className="overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-sm dark:border-violet-800/60 dark:bg-slate-800"
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <SkeletonBlock className="size-4 rounded-md" />
                <SkeletonBlock className="h-3 w-24 rounded-full" />
              </div>
              <SkeletonBlock className="mt-3 h-8 w-36 rounded-full" />
            </div>
            <SkeletonBlock className="h-6 w-24 rounded-full" />
          </div>
          <SkeletonBlock className="mt-5 h-2.5 w-full rounded-full" />
          <div className="mt-2 flex justify-end">
            <SkeletonBlock className="h-3 w-32 rounded-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-violet-200/70 dark:border-violet-800/60">
          {["pieces", "categories"].map((key, index) => (
            <div
              key={key}
              className={`p-4 ${index === 0 ? "border-r border-violet-200/70 dark:border-violet-800/60" : ""}`}
            >
              <div className="flex items-center gap-1.5">
                <SkeletonBlock className="size-4 rounded-md" />
                <SkeletonBlock className="h-3 w-20 rounded-full" />
              </div>
              <SkeletonBlock className="mt-3 h-5 w-28 rounded-full" />
            </div>
          ))}
        </div>
        <div className="border-t border-violet-200/70 px-5 py-3 dark:border-violet-800/60">
          <SkeletonBlock className="h-3 w-4/5 rounded-full" />
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
