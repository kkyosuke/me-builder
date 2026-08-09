import {
  ArrowRight,
  BookHeart,
  Brain,
  ClipboardCheck,
  History,
  LoaderCircle,
  MessageCircleHeart,
  NotebookPen,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { MainNavigation } from "../../../components/main-navigation";
import type { AsyncState } from "../../../model/async-state";
import type {
  ProfileRecordSource,
  ProfileSummary,
  ProfileSummaryRegenerationReason,
  ProfileSummaryResult,
  ProfileSummaryVersioning,
} from "../model/profile-summary";
import { resolveProfileSummarySwipe, summaryCardDragOffset } from "./profile-summary-card-swipe";

const sourceLabels: Record<ProfileRecordSource, string> = {
  diagnosis: "診断",
  diary: "日記",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

const regenerationReasonLabels: Record<ProfileSummaryRegenerationReason, string> = {
  diagnosis: "診断が増えました",
  brain: "日記・記録が増えました",
  elapsed: "前回の生成から時間が経ちました",
};

function versionLabel(sequence: number | null): string {
  return sequence === null ? "最新版" : `第${sequence}版`;
}

function SummarySkeleton() {
  return (
    <output aria-label="わたしのまとめを読み込み中" className="block" aria-live="polite">
      <span className="sr-only">わたしのまとめを読み込んでいます</span>
      <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
        <div className="relative mt-8 pb-4">
          <div className="absolute inset-x-5 top-3 bottom-1 rounded-3xl bg-violet-100 dark:bg-violet-950/60" />
          <div className="absolute inset-x-3 top-1.5 bottom-2.5 rounded-3xl bg-sky-100 dark:bg-sky-950/70" />
          <div className="relative rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-950/10 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start gap-3">
              <div className="size-12 shrink-0 rounded-2xl bg-slate-200 dark:bg-slate-700" />
              <div className="flex-1">
                <div className="h-3 w-20 rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="mt-3 h-5 w-4/5 rounded-full bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {["first", "second", "third"].map((key, index) => (
                <div key={key} className="rounded-2xl bg-slate-100 p-4 dark:bg-slate-900/60">
                  <div className="flex items-center gap-2">
                    <div className="size-6 rounded-full bg-slate-300 dark:bg-slate-700" />
                    <div
                      className={`h-4 rounded-full bg-slate-300 dark:bg-slate-700 ${index === 1 ? "w-2/5" : "w-3/5"}`}
                    />
                  </div>
                  <div className="mt-3 h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700" />
                  <div className="mt-2 h-3 w-4/5 rounded-full bg-slate-200 dark:bg-slate-700" />
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
              {["diagnosis", "diary", "latest"].map((key) => (
                <div
                  key={key}
                  className="mx-auto h-8 w-16 rounded-xl bg-slate-200 dark:bg-slate-700"
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 h-3 w-5/6 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="mt-8 h-5 w-40 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          {["diagnosis", "diary"].map((key) => (
            <div
              key={key}
              className="h-28 rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
            />
          ))}
        </div>
      </div>
    </output>
  );
}

const CARD_TRANSITION_MS = 300;

type CardTransition =
  | Readonly<{ type: "select"; direction: -1 | 1; versionId: string }>
  | Readonly<{ type: "regenerate"; direction: 1 }>;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function SummaryCardStack({
  versioning,
  onSelectVersion,
  onRegenerate,
  children,
}: {
  versioning: ProfileSummaryVersioning;
  onSelectVersion?: (versionId: string) => void;
  onRegenerate?: () => void;
  children: ReactNode;
}) {
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragX, setDragX] = useState(0);
  const [isReturning, setIsReturning] = useState(false);
  const [transition, setTransition] = useState<CardTransition | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(
    () => () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    },
    [],
  );

  const selected =
    versioning.versions.find(({ id }) => id === versioning.selectedVersionId) ??
    versioning.versions[0];
  if (!selected) return null;

  const selectedIndex = versioning.versions.findIndex(({ id }) => id === selected.id);
  const isWorking =
    versioning.generation.status === "queued" || versioning.generation.status === "generating";
  const showsGenerationCard = isWorking && selected.isLatest;
  const canRegenerate = Boolean(
    selected.isLatest && versioning.generation.canRegenerate && !isWorking && onRegenerate,
  );
  const canSwipe =
    !transition && (Boolean(onSelectVersion && versioning.versions.length > 1) || canRegenerate);
  const olderVersion = versioning.versions[selectedIndex + 1];
  const transitionVersion =
    transition?.type === "select"
      ? versioning.versions.find(({ id }) => id === transition.versionId)
      : undefined;
  const revealedVersion = transitionVersion ?? olderVersion;
  const hasGenerationCard = canRegenerate || transition?.type === "regenerate";

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canSwipe || (event.button !== 0 && event.pointerType !== "touch")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    setIsReturning(false);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setDragX(summaryCardDragOffset(event.clientX - start.x, event.clientY - start.y));
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled) {
      setIsReturning(true);
      setDragX(0);
      return;
    }

    const action = resolveProfileSummarySwipe({
      deltaX: event.clientX - start.x,
      deltaY: event.clientY - start.y,
      versioning,
      canRegenerate,
    });
    if (action.type === "none") {
      setIsReturning(true);
      setDragX(0);
      return;
    }

    const nextTransition: CardTransition =
      action.type === "select"
        ? {
            type: "select",
            direction: event.clientX - start.x < 0 ? -1 : 1,
            versionId: action.versionId,
          }
        : { type: "regenerate", direction: 1 };
    const complete = () => {
      if (nextTransition.type === "select") onSelectVersion?.(nextTransition.versionId);
      if (nextTransition.type === "regenerate") onRegenerate?.();
      setTransition(null);
      setDragX(0);
      transitionTimer.current = null;
    };

    if (reducedMotion) {
      complete();
      return;
    }
    setTransition(nextTransition);
    transitionTimer.current = setTimeout(complete, CARD_TRANSITION_MS);
  };

  const reasonText = versioning.generation.reasons
    .map((reason) => regenerationReasonLabels[reason])
    .join("・");

  return (
    <section aria-label="今のわたしの版" aria-roledescription="カルーセル" className="mt-8">
      <div className="relative pb-4">
        {versioning.versions.length > 1 && (
          <div
            aria-hidden="true"
            className="absolute inset-x-5 top-3 bottom-1 rounded-3xl border border-violet-200 bg-violet-100/70 dark:border-violet-800 dark:bg-violet-950/60"
          />
        )}

        {revealedVersion && (
          <div
            aria-hidden="true"
            className="absolute inset-x-3 top-1.5 bottom-2.5 flex items-start justify-end rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-100 to-violet-100 p-4 text-right shadow-md transition-transform duration-300 ease-out motion-reduce:transition-none dark:border-sky-800 dark:from-sky-950 dark:to-violet-950"
            style={{
              transform:
                transition?.type === "select"
                  ? "translate3d(0, 0, 0) scale(1)"
                  : "translate3d(0, 8px, 0) scale(0.96)",
            }}
          >
            <div>
              <p className="text-xs font-bold text-violet-700 dark:text-violet-300">
                {versionLabel(revealedVersion.sequence)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">過去の私</p>
            </div>
          </div>
        )}

        {hasGenerationCard && (
          <div
            aria-hidden="true"
            className={`absolute flex items-center rounded-3xl bg-gradient-to-r from-violet-600 to-sky-500 px-3 text-white shadow-lg transition-all duration-300 ease-out motion-reduce:transition-none ${transition?.type === "regenerate" ? "inset-x-0 top-0 bottom-4 z-[5] scale-100" : "inset-y-4 left-0 right-8 scale-100"}`}
          >
            <div className="flex w-full items-center gap-3">
              <Sparkles className="size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold">
                  {transition?.type === "regenerate"
                    ? "新しい版を追加しています"
                    : "新しい私を見る"}
                </p>
                {transition?.type !== "regenerate" && (
                  <p className="mt-1 text-[11px] text-white/80">右へスワイプして生成</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div
          aria-label={
            showsGenerationCard
              ? `新しい版を作成中、${selectedIndex + 1}/${versioning.versions.length}`
              : `${versionLabel(selected.sequence)}、${selectedIndex + 1}/${versioning.versions.length}`
          }
          className={`relative z-10 select-none transition-transform ease-out motion-reduce:transition-none ${transition || isReturning ? "duration-300" : "duration-0"} ${canRegenerate ? "ml-8 w-[calc(100%-2rem)]" : "w-full"} ${canSwipe ? "cursor-grab touch-pan-y active:cursor-grabbing" : ""}`}
          style={{
            transform: transition
              ? `translate3d(${transition.direction * 115}%, 0, 0) rotate(${transition.direction * 8}deg)`
              : `translate3d(${dragX}px, 0, 0) rotate(${dragX / 60}deg)`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finishPointer(event, false)}
          onPointerCancel={(event) => finishPointer(event, true)}
        >
          {showsGenerationCard ? (
            <section className="flex min-h-[28rem] flex-col items-center justify-center rounded-3xl border border-violet-300/40 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-8 text-center shadow-xl shadow-slate-950/10 dark:from-violet-950/50 dark:via-slate-800 dark:to-sky-950/40">
              <span className="flex size-16 items-center justify-center rounded-3xl bg-violet-500/15 text-violet-700 dark:text-violet-300">
                <LoaderCircle
                  className="size-8 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              </span>
              <p className="mt-5 text-xs font-semibold tracking-wider text-violet-700 dark:text-violet-300">
                新しい私
              </p>
              <h2 className="mt-2 text-xl font-bold text-slate-950 dark:text-slate-50">
                新しい版を作成中
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                診断と日記・記録から、今のあなたをまとめています。完了まで少しお待ちください。
              </p>
              {reasonText && (
                <p className="mt-5 rounded-full bg-violet-100 px-4 py-2 text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                  {reasonText}
                </p>
              )}
              {versioning.versions.length > 1 && (
                <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
                  左へスワイプすると、過去の版を確認できます
                </p>
              )}
            </section>
          ) : (
            children
          )}
        </div>
      </div>

      <div className="mt-1 flex min-h-7 items-center justify-center gap-2" aria-label="まとめの版">
        {versioning.versions.map((version, index) => (
          <button
            key={version.id}
            type="button"
            aria-label={`${versionLabel(version.sequence)}を表示`}
            aria-pressed={version.id === selected.id}
            disabled={!onSelectVersion || version.id === selected.id || Boolean(transition)}
            onClick={() => onSelectVersion?.(version.id)}
            className={`rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${version.id === selected.id ? "h-2.5 w-7 bg-sky-500" : "size-2.5 bg-slate-300 hover:bg-slate-400 dark:bg-slate-600"}`}
          >
            <span className="sr-only">{`${index + 1}/${versioning.versions.length}`}</span>
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-slate-500 dark:text-slate-400">
          {versioning.versions.length > 1
            ? selected.isLatest
              ? "左へスワイプで過去の私"
              : "左右のスワイプで版を移動"
            : "最初のまとめです"}
        </p>
        {canRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={Boolean(transition)}
            className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1.5 font-bold text-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-violet-950 dark:text-violet-200"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            新しい私を見る
          </button>
        )}
      </div>

      {canRegenerate && reasonText && (
        <p className="mt-2 text-xs text-violet-700 dark:text-violet-300">{reasonText}</p>
      )}

      {isWorking && (
        <output className="mt-3 flex items-center gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          新しい版を作成しています。完了するまで、現在の版や過去の版を確認できます。
        </output>
      )}
      {versioning.generation.status === "failed" && (
        <p className="mt-3 text-xs leading-relaxed text-red-700 dark:text-red-300" role="alert">
          {versioning.generation.message ??
            "新しい版を作成できませんでした。現在の版を残したまま再試行できます。"}
        </p>
      )}
    </section>
  );
}

function SummaryCardFrame({
  versioning,
  onSelectVersion,
  onRegenerate,
  children,
}: {
  versioning?: ProfileSummaryVersioning;
  onSelectVersion?: (versionId: string) => void;
  onRegenerate?: () => void;
  children: ReactNode;
}) {
  if (!versioning) return <div className="mt-8">{children}</div>;
  return (
    <SummaryCardStack
      versioning={versioning}
      {...(onSelectVersion ? { onSelectVersion } : {})}
      {...(onRegenerate ? { onRegenerate } : {})}
    >
      {children}
    </SummaryCardStack>
  );
}

function SummaryContent({
  summary,
  availableDataCounts,
  versioning,
  onSelectVersion,
  onRegenerate,
}: {
  summary: ProfileSummary;
  availableDataCounts: Readonly<{ diagnosis: number; diary: number }>;
  versioning?: ProfileSummaryVersioning;
  onSelectVersion?: (versionId: string) => void;
  onRegenerate?: () => void;
}) {
  const selectedVersion = versioning?.versions.find(
    ({ id }) => id === versioning.selectedVersionId,
  );
  return (
    <>
      <SummaryCardFrame
        {...(versioning ? { versioning } : {})}
        {...(onSelectVersion ? { onSelectVersion } : {})}
        {...(onRegenerate ? { onRegenerate } : {})}
      >
        <section className="overflow-hidden rounded-3xl border border-sky-300/30 bg-gradient-to-br from-sky-50 via-white to-violet-50 p-5 shadow-xl shadow-slate-950/10 sm:p-6 dark:from-sky-950/40 dark:via-slate-800 dark:to-violet-950/30">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-700 dark:text-sky-300">
                <Sparkles className="size-6" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold tracking-wider text-sky-700 dark:text-sky-300">
                  今のわたし
                </p>
                <h2 className="mt-1 text-lg font-bold text-slate-950 dark:text-slate-50">
                  {summary.headline}
                </h2>
              </div>
            </div>
            {selectedVersion && (
              <div className="shrink-0 text-right">
                <p className="inline-flex items-center gap-1 text-xs font-bold text-violet-700 dark:text-violet-300">
                  <History className="size-3.5" aria-hidden="true" />
                  {versionLabel(selectedVersion.sequence)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {selectedVersion.generationMethod === "ai" ? "AI生成" : "現在の集計"}
                  {`・${formatDate(selectedVersion.generatedAt)}`}
                </p>
              </div>
            )}
          </div>

          <ol className="mt-5 space-y-3">
            {summary.insights.map((insight, index) => (
              <li key={insight.key} className="rounded-2xl bg-white/80 p-4 dark:bg-slate-900/60">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-sky-500 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <h3 className="font-bold text-slate-950 dark:text-slate-50">{insight.label}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {insight.description}
                </p>
                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span>根拠</span>
                  {insight.sources.map((source) => (
                    <span
                      key={source}
                      className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-700"
                    >
                      {sourceLabels[source]}
                    </span>
                  ))}
                  <span>{`${insight.evidenceCount}件`}</span>
                </p>
              </li>
            ))}
          </ol>

          <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-200/80 pt-4 text-center dark:border-slate-700">
            <div>
              <dt className="text-xs text-slate-500">診断</dt>
              <dd className="mt-1 font-bold text-slate-900 dark:text-slate-100">
                {summary.diagnosisCount}件
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">日記</dt>
              <dd className="mt-1 font-bold text-slate-900 dark:text-slate-100">
                {summary.diaryCount}件
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">最終記録</dt>
              <dd className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                {summary.latestRecordedAt ? formatDate(summary.latestRecordedAt) : "—"}
              </dd>
            </div>
          </dl>
        </section>
      </SummaryCardFrame>

      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        これは記録の範囲から見える現在のまとめです。あなた自身や健康状態を断定するものではなく、記録が変わると内容も変わります。
      </p>

      <section aria-labelledby="sources-heading" className="mt-8">
        <h2
          id="sources-heading"
          className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-50"
        >
          <Brain className="size-5 text-violet-600 dark:text-violet-300" aria-hidden="true" />
          まとめに使えるもの
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <ClipboardCheck className="size-5 text-sky-600 dark:text-sky-300" aria-hidden="true" />
            <p className="mt-3 font-bold text-slate-900 dark:text-slate-100">診断の回答</p>
            <p className="mt-1 text-xs text-slate-500">現在 {availableDataCounts.diagnosis}件</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <NotebookPen
              className="size-5 text-violet-600 dark:text-violet-300"
              aria-hidden="true"
            />
            <p className="mt-3 font-bold text-slate-900 dark:text-slate-100">日記の記録</p>
            <p className="mt-1 text-xs text-slate-500">現在 {availableDataCounts.diary}件</p>
          </div>
        </div>
      </section>
    </>
  );
}

function EmptySummary() {
  return (
    <section className="mt-8 rounded-3xl border border-sky-300/30 bg-white p-6 text-center shadow-xl shadow-slate-950/10 dark:bg-slate-800">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-700 dark:text-sky-300">
        <Sparkles className="size-7" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-xl font-bold text-slate-950 dark:text-slate-50">
        まだ、わたしのまとめはありません
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        診断に答えたり、LINEのトークで日々のことを話したりすると、あなたらしさが少しずつ見えてきます。
      </p>
      <a
        href="/diagnosis"
        className="mt-5 flex items-center justify-between rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        診断を始める
        <ArrowRight className="size-4" aria-hidden="true" />
      </a>
      <p className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
        <MessageCircleHeart className="size-5" aria-hidden="true" />
        LINEで今日のことを話してみる
      </p>
    </section>
  );
}

function NextAction({ action }: { action: ProfileSummaryResult["nextAction"] }) {
  const needsDiagnosis = action === "diagnosis";
  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-700 dark:text-emerald-300">
          {needsDiagnosis ? (
            <BookHeart className="size-5" aria-hidden="true" />
          ) : (
            <MessageCircleHeart className="size-5" aria-hidden="true" />
          )}
        </span>
        <div>
          <h2 className="font-bold text-slate-950 dark:text-slate-50">これからできること</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            {needsDiagnosis
              ? "まだ答えていない診断があります。回答すると、まとめに新しい一面が加わります。"
              : "診断はすべて回答済みです。毎日の会話で、あなたのことをもう少し教えてください。"}
          </p>
        </div>
      </div>
      {needsDiagnosis && (
        <a
          href="/diagnosis"
          className="mt-4 flex items-center justify-between rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          未回答の診断を見る
          <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      )}
    </section>
  );
}

export function ProfileSummaryScreen({
  state,
  availableDataCounts,
  versioning,
  onRetry,
  onSelectVersion,
  onRegenerate,
  children,
}: {
  state: AsyncState<ProfileSummaryResult>;
  availableDataCounts?: Readonly<{ diagnosis: number; diary: number }>;
  versioning?: ProfileSummaryVersioning;
  onRetry: () => void;
  onSelectVersion?: (versionId: string) => void;
  onRegenerate?: () => void;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 pb-28 sm:px-8">
      <header>
        <p className="text-sm font-semibold tracking-wider text-sky-700 dark:text-sky-300">
          私を知る
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50">
          わたしのまとめ
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          これまでの診断と記録から見える、今のあなたです。
        </p>
      </header>

      {state.status === "loading" && <SummarySkeleton />}
      {state.status === "error" && (
        <section className="mt-8 rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center">
          <p className="text-sm text-red-700 dark:text-red-300">まとめを表示できませんでした。</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {state.message}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-300 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            再試行
          </button>
          <a
            href="/diagnosis"
            className="mt-4 block text-sm font-semibold text-sky-700 underline underline-offset-4 dark:text-sky-300"
          >
            診断一覧を見る
          </a>
        </section>
      )}
      {state.status === "success" && (
        <>
          {state.data.summary ? (
            <SummaryContent
              summary={state.data.summary}
              availableDataCounts={
                availableDataCounts ?? {
                  diagnosis: state.data.summary.diagnosisCount,
                  diary: state.data.summary.diaryCount,
                }
              }
              {...(versioning ? { versioning } : {})}
              {...(onSelectVersion ? { onSelectVersion } : {})}
              {...(onRegenerate ? { onRegenerate } : {})}
            />
          ) : (
            <EmptySummary />
          )}
          {state.data.summary && <NextAction action={state.data.nextAction} />}
        </>
      )}

      {children}

      <MainNavigation current="me" />
    </main>
  );
}
