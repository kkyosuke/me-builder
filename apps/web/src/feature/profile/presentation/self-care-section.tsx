import { Ban, HeartHandshake, LoaderCircle, Sparkles, Undo2 } from "lucide-react";
import type { AsyncState } from "../../../model/async-state";
import type {
  SelfCareContextItem,
  SelfCareContextKind,
  SelfCareContextResult,
} from "../model/self-care-context";

const kindContent: Record<
  SelfCareContextKind,
  Readonly<{ heading: string; action: string; tone: string }>
> = {
  worked: {
    heading: "合いやすかったこと",
    action: "役立った",
    tone: "border-teal-100 bg-teal-50/70 dark:border-teal-900 dark:bg-teal-950/30",
  },
  "did-not-work": {
    heading: "合わなかったこと",
    action: "合わなかった",
    tone: "border-amber-100 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
  },
  "recent-state": {
    heading: "最近の状態",
    action: "最近の状態",
    tone: "border-sky-100 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30",
  },
};

function ContextCard({
  item,
  canManage,
  pending,
  onRevoke,
}: {
  item: SelfCareContextItem;
  canManage: boolean;
  pending: boolean;
  onRevoke: () => void;
}) {
  return (
    <article className={`rounded-2xl border p-4 ${kindContent[item.kind].tone}`}>
      <p className="text-xs font-medium text-slate-500">{kindContent[item.kind].heading}</p>
      <p className="mt-1 text-sm leading-6">{item.statement}</p>
      {canManage ? (
        <button
          type="button"
          disabled={pending}
          onClick={onRevoke}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-600 underline disabled:opacity-50 dark:text-slate-300"
        >
          {pending ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <Undo2 className="size-3" />
          )}
          確認を取り消す
        </button>
      ) : null}
    </article>
  );
}

export function SelfCareSection({
  state,
  pendingId,
  operationError,
  onRetry,
  onConfirm,
  onRevoke,
}: {
  state: AsyncState<SelfCareContextResult>;
  pendingId: string | null;
  operationError: string | null;
  onRetry: () => void;
  onConfirm: (brainItemId: string, kind: SelfCareContextKind) => void;
  onRevoke: (id: string) => void;
}) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <output
        className="mt-8 block"
        aria-busy="true"
        aria-label="わたしのセルフケアを読み込んでいます"
      >
        <div className="h-6 w-44 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" />
        <div className="mt-3 h-32 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
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
  const activeItems = state.data.items.filter(({ status }) => status === "active");
  const latestItems = (["recent-state", "worked", "did-not-work"] as const)
    .map((kind) => activeItems.find((item) => item.kind === kind))
    .filter((item): item is SelfCareContextItem => item !== undefined);
  const olderItems = activeItems.filter((item) => !latestItems.some(({ id }) => id === item.id));
  return (
    <section className="mt-8" aria-labelledby="self-care-title">
      <div className="flex items-center gap-2">
        <HeartHandshake className="size-5 text-teal-600" aria-hidden="true" />
        <h2 id="self-care-title" className="font-semibold">
          わたしのセルフケア
        </h2>
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        自分に合ったこと、合わなかったこと、最近の状態を確認して、次の相談へ活かします。
      </p>
      {operationError ? <p className="mt-3 text-sm text-rose-600">{operationError}</p> : null}
      {latestItems.length > 0 ? (
        <div className="mt-3 space-y-3">
          {latestItems.map((item) => (
            <ContextCard
              key={item.id}
              item={item}
              canManage={state.data.canManage}
              pending={pendingId === item.id}
              onRevoke={() => onRevoke(item.id)}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-2xl bg-teal-50 p-4 text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100">
          確認済みのセルフケア情報はまだありません。AIの推定で空欄を埋めず、あなたが話したことから選べます。
        </p>
      )}
      {state.data.canManage && state.data.candidates.length > 0 ? (
        <details className="mt-5 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-semibold">
            話したことからセルフケアへ追加
          </summary>
          <div className="mt-4 space-y-4">
            {state.data.candidates.map((candidate) => (
              <article
                key={candidate.brainItemId}
                className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"
              >
                <p className="text-sm leading-6">{candidate.statement}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["worked", "did-not-work", "recent-state"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      disabled={pendingId === candidate.brainItemId}
                      onClick={() => onConfirm(candidate.brainItemId, kind)}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
                    >
                      {pendingId === candidate.brainItemId ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : kind === "did-not-work" ? (
                        <Ban className="size-3" />
                      ) : (
                        <Sparkles className="size-3" />
                      )}
                      {kindContent[kind].action}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : null}
      {!state.data.canManage ? (
        <p className="mt-3 text-xs text-slate-500">
          Freeの相談では一般的な案と安全案内を利用します。確認済み情報の追加・撤回はLite以上で利用できます。
        </p>
      ) : state.data.candidates.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          日記チャットで役立ったことや最近の状態を話すと、ここから確認できます。
        </p>
      ) : null}
      {olderItems.length > 0 ? (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-medium">以前に確認したこと</summary>
          <div className="mt-3 space-y-3">
            {olderItems.map((item) => (
              <ContextCard
                key={item.id}
                item={item}
                canManage={state.data.canManage}
                pending={pendingId === item.id}
                onRevoke={() => onRevoke(item.id)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
