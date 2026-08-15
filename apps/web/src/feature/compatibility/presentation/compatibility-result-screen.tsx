import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import { ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AsyncState } from "../../../model/async-state";
import {
  getRelationshipCategoryBadgeClassName,
  getRelationshipCategoryLabel,
} from "../../diagnosis/model/relationship-category";
import type { CompatibilityPerson } from "../model/compatibility";
import {
  CompatibilityEndSharing,
  CompatibilitySharingEndedScreen,
} from "./components/compatibility-end-sharing";
import {
  CompatibilityPairSheet,
  CompatibilityPersonSheet,
} from "./components/compatibility-result-sheets";
import { CompatibilityAvatar, CompatibilityBackHeader } from "./components/compatibility-ui";
import { useCompatibilityResult } from "./hooks/use-compatibility-result";
import { useCompatibilitySectionSwipe } from "./hooks/use-compatibility-section-swipe";

export function CompatibilityResultScreen({
  me,
  partner,
  relationshipCategory,
  isRefreshing = false,
  endingState = { status: "idle" },
  onEnd = () => undefined,
}: {
  me: CompatibilityPerson;
  partner: CompatibilityPerson;
  relationshipCategory: CompatibilityRelationshipCategory;
  isRefreshing?: boolean;
  endingState?: AsyncState<null>;
  onEnd?: () => void;
}) {
  const result = useCompatibilityResult();
  const sectionSwipe = useCompatibilitySectionSwipe({
    section: result.state.section,
    showSection: result.showSection,
  });
  const peoplePanelRef = useRef<HTMLDivElement>(null);
  const pairPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    peoplePanelRef.current?.toggleAttribute("inert", result.state.section !== "people");
    pairPanelRef.current?.toggleAttribute("inert", result.state.section !== "pair");
  }, [result.state.section]);

  const sectionIndex = result.state.section === "people" ? 0 : 1;
  const dragOffset = sectionSwipe.dragOffset ?? 0;
  const indicatorPosition = sectionIndex - dragOffset / sectionSwipe.viewportWidth;
  const isDragging = sectionSwipe.dragOffset !== null;

  if (endingState.status === "success") {
    return <CompatibilitySharingEndedScreen />;
  }

  return (
    <main
      aria-busy={isRefreshing || undefined}
      className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 pb-12 sm:px-8"
    >
      {isRefreshing && (
        <output aria-live="polite" className="sr-only">
          相性シートの最新状態を確認しています
        </output>
      )}
      <CompatibilityBackHeader />
      <div className="mt-5 flex items-center gap-3">
        <CompatibilityAvatar person={partner} size="lg" />
        <span className="text-xl font-bold text-slate-400">×</span>
        <CompatibilityAvatar person={me} size="lg" />
      </div>
      <p className="mt-5 text-sm font-semibold tracking-wider text-rose-700 dark:text-rose-300">
        {partner.name}さん × わたし
      </p>
      <p
        className={`mt-2 w-fit rounded-full px-3 py-1.5 text-sm font-bold ${getRelationshipCategoryBadgeClassName(relationshipCategory)}`}
      >
        {getRelationshipCategoryLabel(relationshipCategory)}
      </p>
      <h1
        tabIndex={-1}
        data-compatibility-route-heading="result"
        className="mt-1 text-3xl font-bold text-slate-950 focus:outline-none dark:text-slate-50"
      >
        2人の相性シート
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        回答から見える範囲で作った、私たちを知るための資料です。人物や関係の良し悪しを決めるものではありません。
      </p>

      <div
        className="relative mt-7 grid grid-cols-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800"
        role="tablist"
        aria-label="相性シートの内容"
      >
        <span
          aria-hidden="true"
          data-testid="compatibility-tab-indicator"
          className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-white shadow dark:bg-slate-700 ${isDragging ? "" : "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"}`}
          style={{ transform: `translate3d(${indicatorPosition * 100}%, 0, 0)` }}
        />
        <button
          id="compatibility-people-tab"
          type="button"
          role="tab"
          aria-controls="compatibility-people-panel"
          aria-selected={result.state.section === "people"}
          onClick={() => result.showSection("people")}
          className={`relative z-[1] min-h-11 rounded-xl px-3 text-sm font-bold transition-colors duration-300 motion-reduce:transition-none ${result.state.section === "people" ? "text-slate-950 dark:text-white" : "text-slate-500 dark:text-slate-400"}`}
        >
          それぞれについて
        </button>
        <button
          id="compatibility-pair-tab"
          type="button"
          role="tab"
          aria-controls="compatibility-pair-panel"
          aria-selected={result.state.section === "pair"}
          onClick={() => result.showSection("pair")}
          className={`relative z-[1] min-h-11 rounded-xl px-3 text-sm font-bold transition-colors duration-300 motion-reduce:transition-none ${result.state.section === "pair" ? "text-slate-950 dark:text-white" : "text-slate-500 dark:text-slate-400"}`}
        >
          2人について
        </button>
      </div>

      {/* 外側を8px広げて各パネルへ同量を戻し、スワイプ中だけ内容間に16pxの間隔を作る。 */}
      <div {...sectionSwipe.handlers} className="-mx-2 mt-5 touch-pan-y overflow-hidden">
        <div
          data-testid="compatibility-section-track"
          className={`flex w-[200%] items-start will-change-transform ${isDragging ? "" : "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"}`}
          style={{
            transform: `translate3d(calc(${-sectionIndex * 50}% + ${dragOffset}px), 0, 0)`,
          }}
        >
          <div
            ref={peoplePanelRef}
            id="compatibility-people-panel"
            role="tabpanel"
            aria-labelledby="compatibility-people-tab"
            aria-hidden={result.state.section !== "people"}
            className="w-1/2 shrink-0 space-y-4 px-2"
          >
            <CompatibilityPersonSheet person={partner} isMe={false} />
            <CompatibilityPersonSheet person={me} isMe />
          </div>
          <div
            ref={pairPanelRef}
            id="compatibility-pair-panel"
            role="tabpanel"
            aria-labelledby="compatibility-pair-tab"
            aria-hidden={result.state.section !== "pair"}
            className="w-1/2 shrink-0 px-2"
          >
            <CompatibilityPairSheet
              me={me}
              partner={partner}
              relationshipCategory={relationshipCategory}
            />
          </div>
        </div>
      </div>

      <section className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-700">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          比較には
          {me.themes.map((theme) => `「${theme.title}」`).join("、")}
          を使っています。生の回答は表示していません。
        </p>
        <CompatibilityEndSharing
          className="mt-5"
          confirming={result.state.sharing === "confirming-end"}
          endingState={endingState}
          onRequest={result.requestEnd}
          onCancel={result.cancelEnd}
          onEnd={onEnd}
        />
      </section>
    </main>
  );
}
