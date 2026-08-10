import { AlertCircle, RefreshCw, Send, UserRound } from "lucide-react";
import type { AsyncState } from "../../../model/async-state";
import type {
  CompatibilitySharePreview,
  CompatibilitySharePreviewBlockingReason,
  CompatibilitySharePreviewParameter,
} from "../model/compatibility-share-preview";
import { CompatibilityPrivacyNotice } from "./components/compatibility-disclosure";
import { CompatibilityBackHeader } from "./components/compatibility-ui";

const blockingReasonMessages: Record<CompatibilitySharePreviewBlockingReason, string> = {
  display_name_unavailable: "LINEの表示名を確認できませんでした。",
  diagnosis_required: "共有できる診断結果がまだありません。",
  scoring_unavailable: "一部の診断結果を共有用に準備できませんでした。",
  diagnosis_unavailable: "診断情報を読み込めませんでした。時間をおいて再度お試しください。",
};

function SharePreviewSkeleton() {
  return (
    <output
      aria-label="共有内容を読み込み中"
      aria-live="polite"
      className="mt-8 block animate-pulse space-y-3 motion-reduce:animate-none"
    >
      <span className="sr-only">共有する内容を読み込んでいます</span>
      {["first", "second", "third"].map((key) => (
        <span
          key={key}
          aria-hidden="true"
          className="block h-36 rounded-2xl bg-slate-200 dark:bg-slate-800"
        />
      ))}
    </output>
  );
}

function ShareParameterCard({ parameter }: { parameter: CompatibilitySharePreviewParameter }) {
  return (
    <article className="rounded-2xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-700 dark:bg-rose-950/30">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-2 block size-2 shrink-0 rounded-full bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]"
        />
        <div className="min-w-0 flex-1">
          <h4 className="font-bold text-slate-950 dark:text-slate-50">{parameter.label}</h4>
          <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            「{parameter.statement}」
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 to-rose-400"
              style={{ width: `${parameter.position}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between gap-3 text-[0.6875rem] text-slate-500">
            <span>{parameter.lowLabel}</span>
            <span className="text-right">{parameter.highLabel}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function SharePreviewContent({ preview }: { preview: CompatibilitySharePreview }) {
  const parameterCount = preview.themes.reduce(
    (count, theme) => count + theme.parameters.length,
    0,
  );
  const displayName = preview.displayName ?? "あなた";

  return (
    <>
      <div className="mt-5 flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-20 shrink-0 items-center justify-center rounded-[40%_60%_55%_45%] bg-gradient-to-br from-sky-300 to-cyan-500 text-2xl font-black text-sky-950 shadow-lg"
        >
          {preview.displayName?.slice(0, 1) ?? <UserRound className="size-8" />}
        </span>
        <div>
          <p className="text-sm font-semibold tracking-wider text-rose-700 dark:text-rose-300">
            {displayName}さんから招待
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-950 dark:text-slate-50">
            うつしをシェア
          </h1>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        診断から見える振る舞い・考え方の傾向をすべて共有します。相手に見える内容を確認してから、1人用の招待リンクを発行します。
      </p>

      <section aria-labelledby="themes-heading" className="mt-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-500">相手に見える「私について」</p>
            <h2
              id="themes-heading"
              className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50"
            >
              共有する振る舞い・考え方
            </h2>
          </div>
          <span className="text-right text-sm font-bold text-rose-700 dark:text-rose-300">
            {parameterCount}件すべて共有
          </span>
        </div>
        <div className="mt-4 space-y-6">
          {preview.themes.map((theme, index) => {
            const headingId = `compatibility-share-theme-${index}`;
            return (
              <section key={theme.diagnosisId} aria-labelledby={headingId}>
                <h3
                  id={headingId}
                  className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-300"
                >
                  {theme.title}
                </h3>
                <div className="space-y-3">
                  {theme.parameters.map((parameter) => (
                    <ShareParameterCard
                      key={`${theme.diagnosisId}:${parameter.id}`}
                      parameter={parameter}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <CompatibilityPrivacyNotice
        title="共有されない詳細"
        footer="相手が内容を確認して承諾するまで、共有は始まりません。共有は後から終了できます。"
      />

      {preview.blockingReasons.length > 0 && (
        <section className="mt-8 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-950/30">
          <h2 className="flex items-center gap-2 font-bold text-amber-950 dark:text-amber-100">
            <AlertCircle className="size-5" aria-hidden="true" />
            招待リンクを発行する前に
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900 dark:text-amber-200">
            {preview.blockingReasons.map((reason) => (
              <li key={reason}>・{blockingReasonMessages[reason]}</li>
            ))}
          </ul>
          {preview.nextAction === "diagnosis" && (
            <a
              href="/diagnosis"
              className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-amber-950"
            >
              診断を始める
            </a>
          )}
        </section>
      )}

      <button
        type="button"
        disabled
        className="mt-8 flex min-h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-slate-200 px-5 py-3 font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
      >
        <Send className="size-5" aria-hidden="true" />
        {preview.canIssueInvitation ? "招待リンク発行は準備中" : "招待リンクを発行できません"}
      </button>
      {preview.canIssueInvitation && (
        <p className="mt-2 text-center text-xs leading-relaxed text-slate-500">
          共有内容の確認まで接続済みです。リンク発行は次のAPI実装で利用できます。
        </p>
      )}
    </>
  );
}

export function CompatibilityShareScreen({
  onRetry,
  state,
}: {
  onRetry: () => void;
  state: AsyncState<CompatibilitySharePreview>;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 pb-12 sm:px-8">
      <CompatibilityBackHeader />
      {(state.status === "idle" || state.status === "loading") && <SharePreviewSkeleton />}
      {state.status === "error" && (
        <section className="mt-8 rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center">
          <p className="font-bold text-red-700 dark:text-red-300">
            共有する内容を表示できませんでした
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {state.message}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-300 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            再試行
          </button>
        </section>
      )}
      {state.status === "success" && <SharePreviewContent preview={state.data} />}
    </main>
  );
}
