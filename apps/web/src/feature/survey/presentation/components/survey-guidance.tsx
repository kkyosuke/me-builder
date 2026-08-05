import { ArrowLeft, Info } from "lucide-react";
import type { GuidanceKind } from "../hooks/use-survey-detail";

const GUIDANCE: Record<GuidanceKind, { title: string; message: string }> = {
  closed: {
    title: "このアンケートは受付を終了しました",
    message:
      "回答期間が終了したため、新しく回答を始めたり、途中から再開したりすることはできません。アンケート一覧へお戻りください。",
  },
  unsupported: {
    title: "このアンケートは現在のアプリでは未対応です",
    message:
      "一覧には表示されていますが、回答画面の準備ができていません。対応までしばらくお待ちください。",
  },
  "load-error": {
    title: "アンケートを読み込めませんでした",
    message: "通信状態を確認して、アンケート一覧からもう一度開いてください。",
  },
};

export function SurveyGuidance({ kind, onBack }: { kind: GuidanceKind; onBack: () => void }) {
  const content = GUIDANCE[kind];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center px-4 py-8 sm:px-8">
      <section className="w-full rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center shadow-xl shadow-slate-950/20">
        <Info className="mx-auto size-12 text-sky-300" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold text-slate-50">{content.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">{content.message}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          アンケート一覧へ
        </button>
      </section>
    </main>
  );
}
