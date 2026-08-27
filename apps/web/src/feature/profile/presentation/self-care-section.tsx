import { HeartHandshake, MessageCircleHeart } from "lucide-react";
import { InternalLink } from "../../../components/internal-link";
import type { AsyncState } from "../../../model/async-state";
import { LINE_OFFICIAL_ACCOUNT_URL } from "../../../model/line-official-account";
import type { SelfCareContextItem, SelfCareContextResult } from "../model/self-care-context";

const summaryItems = [
  {
    kind: "stress-trigger",
    heading: "負荷の手がかり",
    emptyLabel: "AIと一緒に見つける",
    tone: "border-sky-100 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30",
  },
  {
    kind: "early-sign",
    heading: "早めのサイン",
    emptyLabel: "AIと一緒に見つける",
    tone: "border-amber-100 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
  },
  {
    kind: "worked",
    heading: "合いやすかったこと",
    emptyLabel: "自分で追加する",
    tone: "border-teal-100 bg-teal-50/70 dark:border-teal-900 dark:bg-teal-950/30",
  },
] as const;

function SummaryItem({
  heading,
  statement,
  emptyLabel,
  tone,
}: {
  heading: string;
  statement?: string;
  emptyLabel: string;
  tone: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-xs font-medium text-slate-500">{heading}</p>
      {statement ? (
        <p className="mt-1 text-sm leading-6">{statement}</p>
      ) : (
        <a
          href={LINE_OFFICIAL_ACCOUNT_URL}
          className="mt-1 inline-flex min-h-8 items-center text-sm font-semibold text-violet-700 underline underline-offset-4 dark:text-violet-300"
        >
          {emptyLabel}
        </a>
      )}
    </div>
  );
}

export function SelfCareSection({
  state,
  onRetry,
}: {
  state: AsyncState<SelfCareContextResult>;
  onRetry: () => void;
}) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <output
        className="mt-8 block"
        aria-busy="true"
        aria-label="わたしのセルフケアを読み込んでいます"
      >
        <div className="h-6 w-44 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" />
        <div className="mt-3 h-48 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
      </output>
    );
  }
  if (state.status === "error") {
    return (
      <section className="mt-8 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">
        <p>{state.message}</p>
        <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">
          もう一度読み込む
        </button>
      </section>
    );
  }

  const activeByKind = new Map<SelfCareContextItem["kind"], SelfCareContextItem>();
  for (const item of state.data.items) {
    if (item.status === "active" && !activeByKind.has(item.kind)) {
      activeByKind.set(item.kind, item);
    }
  }
  return (
    <section className="mt-8" aria-labelledby="self-care-title">
      <div className="flex items-center gap-2">
        <HeartHandshake className="size-5 text-teal-600" aria-hidden="true" />
        <h2 id="self-care-title" className="font-semibold">
          わたしのセルフケア
        </h2>
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        負荷がかかりやすい場面、早めのサイン、合いやすかった対処を確認します。
      </p>
      <div className="mt-3 space-y-3">
        {summaryItems.map((item) => {
          const active = activeByKind.get(item.kind);
          return (
            <SummaryItem
              key={item.heading}
              {...item}
              {...(active ? { statement: active.statement } : {})}
            />
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <InternalLink
          href="/me/self-care"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
        >
          詳しく見る
        </InternalLink>
        <a
          href={LINE_OFFICIAL_ACCOUNT_URL}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white"
        >
          <MessageCircleHeart className="size-4" aria-hidden="true" />
          AIに聞く
        </a>
      </div>
    </section>
  );
}
