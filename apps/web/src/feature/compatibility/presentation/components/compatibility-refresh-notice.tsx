import { AlertCircle, RefreshCw } from "lucide-react";

export function CompatibilityRefreshNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <aside
      aria-live="polite"
      aria-label="最新状態の確認結果"
      className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-bold">最新状態を確認できませんでした</p>
          <p className="mt-1 text-sm">{message} 表示中の内容を残しています。</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-200 px-4 text-sm font-bold text-amber-950"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        もう一度確認
      </button>
    </aside>
  );
}
