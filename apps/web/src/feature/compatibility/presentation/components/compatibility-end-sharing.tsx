import { LoaderCircle, ShieldCheck } from "lucide-react";
import type { AsyncState } from "../../../../model/async-state";

export function CompatibilitySharingEndedScreen() {
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
    </main>
  );
}

export function CompatibilityEndSharing({
  confirming,
  endingState,
  onRequest,
  onCancel,
  onEnd,
  className = "mt-8 border-t border-slate-200 pt-6 dark:border-slate-700",
}: {
  confirming: boolean;
  endingState: AsyncState<null>;
  onRequest: () => void;
  onCancel: () => void;
  onEnd: () => void;
  className?: string;
}) {
  return (
    <div className={className}>
      {confirming ? (
        <div className="rounded-2xl border border-red-300/50 bg-red-50 p-4 dark:border-red-700/40 dark:bg-red-950/30">
          <p className="font-bold text-red-950 dark:text-red-100">共有を終了しますか？</p>
          <p className="mt-1 text-sm leading-relaxed text-red-800 dark:text-red-200">
            終了すると、2人ともこの相性シートを見られなくなります。
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={endingState.status === "loading"}
              onClick={onEnd}
              className="min-h-11 flex-1 rounded-xl bg-red-600 px-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-70"
            >
              {endingState.status === "loading" && (
                <LoaderCircle
                  className="mr-2 inline size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {endingState.status === "loading" ? "終了しています..." : "共有を終了"}
            </button>
            <button
              type="button"
              disabled={endingState.status === "loading"}
              onClick={onCancel}
              className="min-h-11 flex-1 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 disabled:cursor-wait disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
            >
              戻る
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onRequest}
          className="min-h-11 text-sm font-bold text-red-700 underline underline-offset-4 dark:text-red-300"
        >
          共有を終了する
        </button>
      )}
      {endingState.status === "error" && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">
          {endingState.message}
        </p>
      )}
    </div>
  );
}
