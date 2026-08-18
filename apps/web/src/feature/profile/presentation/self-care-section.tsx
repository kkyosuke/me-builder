import { HeartHandshake, LoaderCircle, MessageCircleHeart, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import type { AsyncState } from "../../../model/async-state";
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

const consultationPrompts = [
  "今しんどい。何からすればいい？",
  "この傾向だと、どんな場面で疲れやすそう？",
  "最近の記録から、早めのサインを整理したい",
  "自分に合いそうな休み方を一緒に考えたい",
  "セルフケアについて自由に相談したい",
] as const;

export type SelfCareConsultationStartResult = "sent" | "copied" | "unavailable";

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
      {canManage ? (
        <button
          type="button"
          disabled={disabled}
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
  onRevoke,
  onConsult,
}: {
  state: AsyncState<SelfCareContextResult>;
  pendingId: string | null;
  operationError: string | null;
  onRetry: () => void;
  onRevoke: (id: string) => void;
  onConsult: (prompt: string) => Promise<SelfCareConsultationStartResult>;
}) {
  const [consultationStatus, setConsultationStatus] = useState<
    SelfCareConsultationStartResult | "sending" | null
  >(null);
  const consultationPendingRef = useRef(false);
  const startConsultation = async (prompt: string): Promise<void> => {
    if (consultationPendingRef.current) return;
    consultationPendingRef.current = true;
    setConsultationStatus("sending");
    try {
      setConsultationStatus(await onConsult(prompt));
    } catch {
      setConsultationStatus("unavailable");
    } finally {
      consultationPendingRef.current = false;
    }
  };
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
  const busy = pendingId !== null;
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
      {operationError ? (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {operationError}
        </p>
      ) : null}
      {latestItems.length > 0 ? (
        <div className="mt-3 space-y-3">
          {latestItems.map((item) => (
            <ContextCard
              key={item.id}
              item={item}
              canManage={state.data.canManage}
              pending={pendingId === item.id}
              disabled={busy}
              onRevoke={() => onRevoke(item.id)}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-2xl bg-teal-50 p-4 text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100">
          確認済みのセルフケア情報はまだありません。AIの推定で空欄を埋めず、本人が確認した内容だけを表示します。
        </p>
      )}
      {!state.data.canManage ? (
        <p className="mt-3 text-xs text-slate-500">
          Freeの相談では一般的な案と安全案内を利用します。確認済み情報を使った個別化と撤回はLite以上で利用できます。
        </p>
      ) : null}
      <section className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/30">
        <div className="flex items-center gap-2">
          <MessageCircleHeart className="size-4 text-violet-700 dark:text-violet-300" />
          <h3 className="text-sm font-semibold">AIに聞く</h3>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
          今の状況を優先して相談します。緊急性が高い内容では、通常の提案を止めて日本国内の案内へ切り替わります。
        </p>
        <div className="mt-3 grid gap-2">
          {consultationPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={consultationStatus === "sending"}
              onClick={() => void startConsultation(prompt)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-800 disabled:opacity-50 dark:border-violet-800 dark:bg-slate-900 dark:text-slate-100"
            >
              {prompt}
            </button>
          ))}
        </div>
        {consultationStatus === "sending" ? (
          <output
            aria-live="polite"
            className="mt-3 block text-xs text-slate-600 dark:text-slate-300"
          >
            LINEのトークを開いています…
          </output>
        ) : consultationStatus === "sent" ? (
          <output
            aria-live="polite"
            className="mt-3 block text-xs text-slate-600 dark:text-slate-300"
          >
            LINEのトークへ相談文を送信しました。
          </output>
        ) : consultationStatus === "copied" ? (
          <output
            aria-live="polite"
            className="mt-3 block text-xs text-slate-600 dark:text-slate-300"
          >
            相談文をコピーしました。LINEのトークへ貼り付けて送信してください。
          </output>
        ) : consultationStatus === "unavailable" ? (
          <p role="alert" className="mt-3 text-xs text-rose-700 dark:text-rose-300">
            このブラウザではLINEへ移動できません。LINE内から「わたしのまとめ」を開き直してください。
          </p>
        ) : null}
      </section>
      {olderItems.length > 0 ? (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-medium">以前に確認したこと</summary>
          <div className="mt-3 space-y-3">
            {olderItems.slice(0, 20).map((item) => (
              <ContextCard
                key={item.id}
                item={item}
                canManage={state.data.canManage}
                pending={pendingId === item.id}
                disabled={busy}
                onRevoke={() => onRevoke(item.id)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
