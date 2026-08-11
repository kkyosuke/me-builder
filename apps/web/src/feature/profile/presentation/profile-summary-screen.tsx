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

type CardTransition = Readonly<{ type: "select"; direction: -1 | 1; versionId: string }>;

type ProfileSummaryVersion = ProfileSummaryVersioning["versions"][number];

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
  renderCard,
}: {
  versioning: ProfileSummaryVersioning;
  onSelectVersion?: (versionId: string) => void;
  onRegenerate?: () => void;
  renderCard: (version: ProfileSummaryVersion | undefined) => ReactNode;
}) {
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const activeCard = useRef<HTMLDivElement | null>(null);
  const preparationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragX, setDragX] = useState(0);
  const [isReturning, setIsReturning] = useState(false);
  const [transition, setTransition] = useState<CardTransition | null>(null);
  const [transitionStarted, setTransitionStarted] = useState(false);
  const [generationCardHeight, setGenerationCardHeight] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(
    () => () => {
      if (preparationTimer.current) clearTimeout(preparationTimer.current);
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
  const latestVersion =
    versioning.versions.find(({ isLatest }) => isLatest) ?? versioning.versions[0];
  const firstPastVersion = versioning.versions.find(({ isLatest }) => !isLatest);
  const hasPastVersions = Boolean(firstPastVersion);
  const canSwipe = !transition && Boolean(onSelectVersion && versioning.versions.length > 1);
  const adjacentVersion =
    dragX > 0 ? versioning.versions[selectedIndex - 1] : versioning.versions[selectedIndex + 1];
  const transitionVersion = transition
    ? versioning.versions.find(({ id }) => id === transition.versionId)
    : undefined;
  const revealedVersion = transitionVersion ?? adjacentVersion;
  const showsIncomingCard = Boolean(revealedVersion && (dragX !== 0 || transition));
  const incomingIsNewer = (transition?.direction ?? (dragX > 0 ? 1 : -1)) > 0;
  const reservesGenerationStatus =
    versioning.generation.canRegenerate || versioning.generation.status !== "idle";

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

  const selectVersion = (
    versionId: string,
    direction: CardTransition["direction"],
    prepareFromRest = false,
  ) => {
    const nextTransition: CardTransition = { type: "select", direction, versionId };
    const complete = () => {
      onSelectVersion?.(nextTransition.versionId);
      transitionTimer.current = null;
      preparationTimer.current = setTimeout(() => {
        setTransition(null);
        setTransitionStarted(false);
        setDragX(0);
        preparationTimer.current = null;
      }, 0);
    };

    if (reducedMotion) {
      complete();
      return;
    }

    setTransition(nextTransition);
    setTransitionStarted(!prepareFromRest);
    const start = () => {
      setTransitionStarted(true);
      preparationTimer.current = null;
      transitionTimer.current = setTimeout(complete, CARD_TRANSITION_MS);
    };
    if (prepareFromRest) {
      preparationTimer.current = setTimeout(start, 0);
    } else {
      start();
    }
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
    });
    if (action.type === "none") {
      setIsReturning(true);
      setDragX(0);
      return;
    }

    selectVersion(action.versionId, event.clientX - start.x < 0 ? -1 : 1, dragX === 0);
  };

  const reasonText = versioning.generation.reasons
    .map((reason) => regenerationReasonLabels[reason])
    .join("・");
  const requestRegeneration = () => {
    setGenerationCardHeight(activeCard.current?.offsetHeight ?? null);
    onRegenerate?.();
  };

  return (
    <section aria-label="今のわたしの版" aria-roledescription="カルーセル" className="mt-8">
      <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">
          {selected.isLatest ? (
            <Sparkles className="size-4 text-violet-600 dark:text-violet-300" aria-hidden="true" />
          ) : (
            <History className="size-4" aria-hidden="true" />
          )}
          {selected.isLatest ? "最新のまとめ" : "過去のまとめ"}
        </p>
        {!selected.isLatest && latestVersion && onSelectVersion && (
          <button
            type="button"
            onClick={() => selectVersion(latestVersion.id, 1, true)}
            disabled={Boolean(transition)}
            className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-2 text-xs font-bold text-sky-800 transition hover:bg-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:opacity-50 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900"
          >
            最新のまとめへ
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="relative pb-4">
        {revealedVersion && showsIncomingCard && (
          <div
            aria-hidden="true"
            data-summary-card-layer="incoming"
            data-summary-card-entry={incomingIsNewer ? "foreground" : "background"}
            className={`pointer-events-none absolute origin-top ease-out motion-reduce:transition-none ${transitionStarted ? "transition-all duration-300" : "transition-none duration-0"} ${incomingIsNewer ? "inset-x-0 top-0 z-20" : `${transitionStarted ? "inset-x-0 top-0" : "inset-x-3 top-1.5"} z-[5]`}`}
            style={{
              transform: incomingIsNewer
                ? transitionStarted
                  ? "translate3d(0, 0, 0) scale(1)"
                  : `translate3d(calc(-105% + ${Math.max(0, dragX)}px), 0, 0) scale(1)`
                : transitionStarted
                  ? "translate3d(0, 0, 0) scale(1)"
                  : "translate3d(0, 8px, 0) scale(0.96)",
            }}
          >
            {renderCard(revealedVersion)}
          </div>
        )}

        <div
          ref={activeCard}
          data-summary-card-layer="active"
          aria-label={
            showsGenerationCard
              ? "新しい版を作成中"
              : selected.isLatest
                ? "最新のまとめ"
                : "過去のまとめ"
          }
          className={`relative z-10 w-full select-none transition-transform ease-out motion-reduce:transition-none ${transitionStarted || isReturning ? "duration-300" : "duration-0"} ${canSwipe ? "cursor-grab touch-pan-y active:cursor-grabbing" : ""}`}
          style={{
            transform:
              transition && transitionStarted
                ? `translate3d(${transition.direction * 115}%, 0, 0) rotate(${transition.direction * 8}deg)`
                : `translate3d(${dragX}px, 0, 0) rotate(${dragX / 60}deg)`,
            ...(showsGenerationCard && generationCardHeight
              ? { height: `${generationCardHeight}px` }
              : {}),
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finishPointer(event, false)}
          onPointerCancel={(event) => finishPointer(event, true)}
        >
          {showsGenerationCard ? (
            <section
              className={`flex flex-col items-center justify-center rounded-3xl border border-violet-300/40 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-8 text-center shadow-xl shadow-slate-950/10 dark:from-violet-950/50 dark:via-slate-800 dark:to-sky-950/40 ${generationCardHeight ? "h-full" : "min-h-[28rem]"}`}
            >
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
            renderCard(selected)
          )}
        </div>
      </div>

      {selected.isLatest && hasPastVersions && onSelectVersion && firstPastVersion && (
        <div className="mt-1 flex justify-center">
          <button
            type="button"
            onClick={() => selectVersion(firstPastVersion.id, -1, true)}
            disabled={Boolean(transition)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <History className="size-3.5" aria-hidden="true" />
            過去のまとめがあります
          </button>
        </div>
      )}

      {canRegenerate && (
        <button
          type="button"
          onClick={requestRegeneration}
          disabled={Boolean(transition)}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-950/15 transition hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400"
        >
          <Sparkles className="size-4.5" aria-hidden="true" />
          最新のわたしを知る
        </button>
      )}

      {reasonText && (
        <p
          aria-hidden={!canRegenerate}
          className={`mt-2 min-h-4 text-xs text-violet-700 dark:text-violet-300 ${canRegenerate ? "visible" : "invisible"}`}
        >
          {reasonText}
        </p>
      )}

      {reservesGenerationStatus && (
        <div className="mt-3 min-h-5">
          {isWorking && (
            <output className="flex items-center gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              新しい版を作成しています。完了するまで、現在の版や過去の版を確認できます。
            </output>
          )}
          {versioning.generation.status === "failed" && (
            <p className="text-xs leading-relaxed text-red-700 dark:text-red-300" role="alert">
              {versioning.generation.message ??
                "新しい版を作成できませんでした。現在の版を残したまま再試行できます。"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function SummaryCardFrame({
  versioning,
  onSelectVersion,
  onRegenerate,
  renderCard,
}: {
  versioning?: ProfileSummaryVersioning;
  onSelectVersion?: (versionId: string) => void;
  onRegenerate?: () => void;
  renderCard: (version: ProfileSummaryVersion | undefined) => ReactNode;
}) {
  if (!versioning) return <div className="mt-8">{renderCard(undefined)}</div>;
  return (
    <SummaryCardStack
      versioning={versioning}
      {...(onSelectVersion ? { onSelectVersion } : {})}
      {...(onRegenerate ? { onRegenerate } : {})}
      renderCard={renderCard}
    />
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
  const renderCard = (selectedVersion: ProfileSummaryVersion | undefined) => {
    const cardSummary = selectedVersion?.summary ?? summary;
    return (
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
                {cardSummary.headline}
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
          {cardSummary.insights.map((insight, index) => (
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
              {cardSummary.diagnosisCount}件
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">日記</dt>
            <dd className="mt-1 font-bold text-slate-900 dark:text-slate-100">
              {cardSummary.diaryCount}件
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">最終記録</dt>
            <dd className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
              {cardSummary.latestRecordedAt ? formatDate(cardSummary.latestRecordedAt) : "—"}
            </dd>
          </div>
        </dl>
      </section>
    );
  };
  return (
    <>
      <SummaryCardFrame
        {...(versioning ? { versioning } : {})}
        {...(onSelectVersion ? { onSelectVersion } : {})}
        {...(onRegenerate ? { onRegenerate } : {})}
        renderCard={renderCard}
      />

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

function EmptySummary({
  generation,
  onRegenerate,
}: {
  generation?: ProfileSummaryVersioning["generation"];
  onRegenerate?: () => void;
}) {
  const isWorking = generation?.status === "queued" || generation?.status === "generating";
  if (isWorking) {
    return (
      <output
        aria-label="新しい版を作成中"
        className="mt-8 flex min-h-[28rem] flex-col items-center justify-center rounded-3xl border border-violet-300/40 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-8 text-center shadow-xl shadow-slate-950/10 dark:from-violet-950/50 dark:via-slate-800 dark:to-sky-950/40"
      >
        <LoaderCircle
          className="size-12 animate-spin text-violet-700 motion-reduce:animate-none dark:text-violet-300"
          aria-hidden="true"
        />
        <h2 className="mt-5 text-xl font-bold text-slate-950 dark:text-slate-50">
          新しい版を作成中
        </h2>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          診断と日記・記録から、最初のまとめを作っています。完了まで少しお待ちください。
        </p>
      </output>
    );
  }

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
      {generation?.status === "idle" && generation.canRegenerate && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          最初のまとめを作る
        </button>
      )}
      {generation?.status === "failed" && (
        <div className="mt-5 rounded-2xl bg-red-50 p-4 text-left dark:bg-red-950/30">
          <p className="text-sm leading-relaxed text-red-700 dark:text-red-300" role="alert">
            {generation.message ?? "最初のまとめを作成できませんでした。再試行してください。"}
          </p>
          {generation.canRegenerate && onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="mt-3 rounded-xl bg-red-200 px-4 py-2 text-sm font-bold text-red-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
            >
              再試行
            </button>
          )}
        </div>
      )}
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
            <EmptySummary
              {...(versioning ? { generation: versioning.generation } : {})}
              {...(onRegenerate ? { onRegenerate } : {})}
            />
          )}
          {state.data.summary && <NextAction action={state.data.nextAction} />}
        </>
      )}

      {children}

      <MainNavigation current="me" />
    </main>
  );
}
