import { ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CompatibilityPerson } from "../model/compatibility";
import {
  CompatibilityPairSheet,
  CompatibilityPersonSheet,
} from "./components/compatibility-result-sheets";
import {
  CompatibilityAvatar,
  CompatibilityBackHeader,
  DemoNotice,
} from "./components/compatibility-ui";
import { useCompatibilityResult } from "./hooks/use-compatibility-result";
import { useCompatibilitySectionSwipe } from "./hooks/use-compatibility-section-swipe";

export function CompatibilityResultScreen({
  me,
  partner,
}: {
  me: CompatibilityPerson;
  partner: CompatibilityPerson;
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

  if (result.state.sharing === "ended") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-800">
          <span className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            <ShieldCheck className="size-8" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-bold text-slate-950 dark:text-slate-50">
            共有を終了しました
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            2人ともこの相性シートを見られなくなりました。もう一度始めるには、新しい招待と双方の承諾が必要です。
          </p>
          <a
            href="/compatibility"
            className="mt-6 flex min-h-12 items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white dark:bg-slate-50 dark:text-slate-950"
          >
            相性一覧へ戻る
          </a>
        </section>
        <DemoNotice />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 pb-12 sm:px-8">
      <CompatibilityBackHeader />
      <div className="mt-5 flex items-center gap-3">
        <CompatibilityAvatar person={partner} size="lg" />
        <span className="text-xl font-bold text-slate-400">×</span>
        <CompatibilityAvatar person={me} size="lg" />
      </div>
      <p className="mt-5 text-sm font-semibold tracking-wider text-rose-700 dark:text-rose-300">
        {partner.name}さん × わたし
      </p>
      <h1 className="mt-1 text-3xl font-bold text-slate-950 dark:text-slate-50">2人の相性シート</h1>
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

      <div {...sectionSwipe.handlers} className="mt-5 touch-pan-y overflow-hidden">
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
            className="w-1/2 shrink-0 space-y-4"
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
            className="w-1/2 shrink-0"
          >
            <CompatibilityPairSheet me={me} partner={partner} />
          </div>
        </div>
      </div>

      <section className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-700">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          比較には「予定の立て方」「休日の過ごし方」「お金の使い方」を使っています。生の回答は表示していません。
        </p>
        {result.state.sharing === "confirming-end" ? (
          <div className="mt-5 rounded-2xl border border-red-300/50 bg-red-50 p-4 dark:border-red-700/40 dark:bg-red-950/30">
            <p className="font-bold text-red-950 dark:text-red-100">共有を終了しますか？</p>
            <p className="mt-1 text-sm leading-relaxed text-red-800 dark:text-red-200">
              終了すると、2人ともこの相性シートを見られなくなります。
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={result.confirmEnd}
                className="min-h-11 flex-1 rounded-xl bg-red-600 px-3 text-sm font-bold text-white"
              >
                共有を終了
              </button>
              <button
                type="button"
                onClick={result.cancelEnd}
                className="min-h-11 flex-1 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200"
              >
                戻る
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={result.requestEnd}
            className="mt-5 min-h-11 text-sm font-bold text-red-700 underline underline-offset-4 dark:text-red-300"
          >
            共有を終了する
          </button>
        )}
      </section>
      <DemoNotice />
    </main>
  );
}
