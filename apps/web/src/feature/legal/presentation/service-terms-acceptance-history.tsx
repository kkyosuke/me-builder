import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { config } from "../../../config";
import { fetchServiceTermsAcceptanceHistory } from "../infrastructure/service-terms-api";
import type { ServiceTermsAcceptanceHistoryItem } from "../model/service-terms";

type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; acceptances: readonly ServiceTermsAcceptanceHistoryItem[] };

const acceptedAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

export function ServiceTermsAcceptanceHistory() {
  const [state, setState] = useState<HistoryState>({ status: "loading" });

  useEffect(() => {
    if (state.status !== "loading") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const acceptances = await fetchServiceTermsAcceptanceHistory(
          config.apiUrl,
          controller.signal,
        );
        if (!controller.signal.aborted) setState({ status: "ready", acceptances });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "同意履歴を取得できませんでした。",
          });
        }
      }
    })();
    return () => controller.abort();
  }, [state.status]);

  if (state.status === "loading") {
    return (
      <output
        aria-busy="true"
        aria-label="利用規約の同意履歴を読み込んでいます"
        className="mt-3 block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      >
        <span aria-hidden="true" className="block space-y-3">
          <span className="block h-5 w-24 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" />
          <span className="block h-20 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-700/70" />
        </span>
      </output>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100"
      >
        <p className="text-sm font-bold">{state.message}</p>
        <button
          type="button"
          onClick={() => setState({ status: "loading" })}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:bg-slate-800"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          再試行
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <h3 className="font-bold text-slate-950 dark:text-white">同意履歴</h3>
      {state.acceptances.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">同意履歴はありません。</p>
      ) : (
        <ol className="mt-3 divide-y divide-slate-200 dark:divide-slate-700">
          {state.acceptances.map((acceptance, index) => (
            <li
              key={`${acceptance.version}-${acceptance.acceptedAt}-${index}`}
              className="py-4 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-950 dark:text-white">
                  version {acceptance.version}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    acceptance.status === "current"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}
                >
                  {acceptance.status === "current" ? "現在有効" : "過去の同意"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {acceptedAtFormatter.format(new Date(acceptance.acceptedAt))} に同意
              </p>
              <p className="mt-2 break-all font-mono text-[0.6875rem] leading-relaxed text-slate-500 dark:text-slate-400">
                {acceptance.documentHash ?? "本文hashの記録なし"}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
