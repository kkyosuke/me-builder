import { ArrowLeft, HeartHandshake, LoaderCircle, MessageCircleHeart, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AsyncState } from "../../../model/async-state";
import { LINE_OFFICIAL_ACCOUNT_URL } from "../../../model/line-official-account";
import type {
  SelfCareContextItem,
  SelfCareContextKind,
  SelfCareContextResult,
} from "../model/self-care-context";

const kindContent: Record<SelfCareContextKind, Readonly<{ heading: string; tone: string }>> = {
  worked: {
    heading: "合いやすかったこと",
    tone: "border-teal-100 bg-teal-50/70 dark:border-teal-900 dark:bg-teal-950/30",
  },
  "did-not-work": {
    heading: "合わなかったこと",
    tone: "border-amber-100 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
  },
  "recent-state": {
    heading: "最近の状態",
    tone: "border-sky-100 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30",
  },
};

function ContextCard({
  item,
  canManage,
  pending,
  disabled,
  onRevoke,
}: {
  item: SelfCareContextItem;
  canManage: boolean;
  pending: boolean;
  disabled: boolean;
  onRevoke: () => void;
}) {
  return (
    <article className={`rounded-2xl border p-4 ${kindContent[item.kind].tone}`}>
      <p className="text-xs font-medium text-slate-500">{kindContent[item.kind].heading}</p>
      <p className="mt-1 text-sm leading-6">{item.statement}</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <a
          href={LINE_OFFICIAL_ACCOUNT_URL}
          className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-violet-700 underline underline-offset-4 dark:text-violet-300"
        >
          <MessageCircleHeart className="size-3" aria-hidden="true" />
          AIに聞く
        </a>
        {canManage ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onRevoke}
            className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-slate-600 underline underline-offset-4 disabled:opacity-50 dark:text-slate-300"
          >
            {pending ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Undo2 className="size-3" />
            )}
            確認を取り消す
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function SelfCareDetailsScreen({
  state,
  pendingId,
  operationError,
  onBack,
  onRetry,
  onRevoke,
}: {
  state: AsyncState<SelfCareContextResult>;
  pendingId: string | null;
  operationError: string | null;
  onBack: () => void;
  onRetry: () => void;
  onRevoke: (id: string) => void;
}) {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backButtonRef.current?.focus(), []);

  const content = (() => {
    if (state.status === "loading" || state.status === "idle") {
      return <p aria-live="polite">セルフケア情報を読み込んでいます...</p>;
    }
    if (state.status === "error") {
      return (
        <section className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">
          <p>{state.message}</p>
          <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">
            もう一度読み込む
          </button>
        </section>
      );
    }

    const activeItems = state.data.items.filter(({ status }) => status === "active");
    return (
      <>
        {operationError ? (
          <p role="alert" className="mb-3 text-sm text-rose-600">
            {operationError}
          </p>
        ) : null}
        {activeItems.length > 0 ? (
          <div className="space-y-3">
            {activeItems.map((item) => (
              <ContextCard
                key={item.id}
                item={item}
                canManage={state.data.canManage}
                pending={pendingId === item.id}
                disabled={pendingId !== null}
                onRevoke={() => onRevoke(item.id)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-teal-50 p-4 text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100">
            <p>確認済みのセルフケア情報はまだありません。</p>
            <div className="mt-3 flex flex-wrap gap-4">
              <a
                href={LINE_OFFICIAL_ACCOUNT_URL}
                className="font-semibold text-violet-700 underline underline-offset-4 dark:text-violet-300"
              >
                AIと一緒に見つける
              </a>
              <a
                href={LINE_OFFICIAL_ACCOUNT_URL}
                className="font-semibold text-violet-700 underline underline-offset-4 dark:text-violet-300"
              >
                自分で追加する
              </a>
            </div>
          </div>
        )}
        {!state.data.canManage ? (
          <p className="mt-3 text-xs text-slate-500">
            Freeの相談では一般的な案と安全案内を利用します。確認済み情報を使った個別化と撤回はLite以上で利用できます。
          </p>
        ) : null}
      </>
    );
  })();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 sm:px-8">
      <button
        ref={backButtonRef}
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-slate-700 dark:text-slate-200"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        わたしのまとめへ戻る
      </button>
      <header className="mt-5">
        <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300">
          <HeartHandshake className="size-5" aria-hidden="true" />
          <p className="text-sm font-semibold">私を知る</p>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50">
          わたしのセルフケア
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          あなたが確認した情報だけを表示します。
        </p>
      </header>
      <section className="mt-8" aria-label="確認済みのセルフケア情報">
        {content}
      </section>
      <a
        href={LINE_OFFICIAL_ACCOUNT_URL}
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white"
      >
        <MessageCircleHeart className="size-4" aria-hidden="true" />
        AIに聞く
      </a>
    </main>
  );
}
