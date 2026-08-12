import { ArrowLeft, Info } from "lucide-react";
import type { GuidanceKind } from "../hooks/use-diagnosis-detail";

const GUIDANCE: Record<GuidanceKind, { title: string; message: string }> = {
  closed: {
    title: "この診断は受付を終了しました",
    message:
      "回答期間が終了したため、新しく回答を始めたり、途中から再開したりすることはできません。診断一覧へお戻りください。",
  },
  unsupported: {
    title: "この診断は現在のアプリでは未対応です",
    message:
      "一覧には表示されていますが、回答画面の準備ができていません。対応までしばらくお待ちください。",
  },
  "invalid-link": {
    title: "この回答結果を開けません",
    message: "診断が見つからないか、現在は表示できません。戻って最新の状態をご確認ください。",
  },
  "load-error": {
    title: "診断を読み込めませんでした",
    message: "通信状態を確認して、診断一覧からもう一度開いてください。",
  },
};

export function DiagnosisGuidance({
  kind,
  onBack,
  onRetry,
  backHref,
  backLabel = "診断一覧へ",
}: {
  kind: GuidanceKind;
  onBack: () => void;
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
}) {
  const content = GUIDANCE[kind];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center px-4 py-8 sm:px-8">
      <section className="w-full rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-center shadow-xl shadow-slate-950/20">
        <Info className="mx-auto size-12 text-sky-700 dark:text-sky-300" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold text-slate-950 dark:text-slate-50">
          {content.title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {content.message}
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center justify-center rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              もう一度読み込む
            </button>
          )}
          {backHref ? (
            <a
              href={backHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:text-slate-300"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {backLabel}
            </a>
          ) : (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {backLabel}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
