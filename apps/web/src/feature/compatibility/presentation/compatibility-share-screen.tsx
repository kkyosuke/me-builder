import {
  AlertCircle,
  CheckCircle2,
  Copy,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { AsyncState } from "../../../model/async-state";
import type { CompatibilityInvitation } from "../model/compatibility-invitation";
import type {
  CompatibilitySharePreview,
  CompatibilitySharePreviewBlockingReason,
  CompatibilitySharePreviewParameter,
} from "../model/compatibility-share-preview";
import { CompatibilityPrivacyNotice } from "./components/compatibility-disclosure";
import { CompatibilityBackHeader } from "./components/compatibility-ui";

const blockingReasonMessages: Record<CompatibilitySharePreviewBlockingReason, string> = {
  display_name_unavailable: "LINEの表示名を確認できませんでした。",
  profile_summary_required: "共有用の「私について」がまだ作成されていません。",
  profile_summary_stale: "共有用の「私について」に更新が必要です。",
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
            {parameter.statement}
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

function SharePreviewContent({
  invitationState,
  onCopyLink,
  onIssue,
  onRetryPreview,
  onShareToLine,
  preview,
  sharingMessage,
}: {
  invitationState: AsyncState<CompatibilityInvitation>;
  onCopyLink: (url: string) => void;
  onIssue: (previewToken: string) => void;
  onRetryPreview: () => void;
  onShareToLine: (url: string) => void;
  preview: CompatibilitySharePreview;
  sharingMessage: string | null;
}) {
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
        診断と記録から一般化した振る舞い・考え方と、診断テーマの傾向をすべて共有します。相手に見える内容を確認してから、1人用の招待リンクを発行します。
      </p>

      {preview.aboutMe && (
        <section aria-labelledby="about-me-heading" className="mt-8">
          <p className="text-xs font-bold text-slate-500">相手に見える「私について」</p>
          <h2
            id="about-me-heading"
            className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-950 dark:text-slate-50"
          >
            <Sparkles className="size-5 text-violet-500" aria-hidden="true" />
            まず知ってほしいこと
          </h2>
          <div className="mt-4 space-y-3">
            {preview.aboutMe.statements.map((item) => (
              <article
                key={item.key}
                className="rounded-2xl border border-violet-300 bg-violet-50 p-4 dark:border-violet-700 dark:bg-violet-950/30"
              >
                <h3 className="text-sm font-bold text-violet-950 dark:text-violet-100">
                  {item.label}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {item.statement}
                </p>
              </article>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            わたしの傾向で生成した版を使用しています。新しい版は確認するまで自動共有されません。
          </p>
        </section>
      )}

      <section aria-labelledby="themes-heading" className="mt-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-500">2人の比較に使う診断テーマ</p>
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
          {preview.nextAction === "profile-summary" && (
            <a
              href="/me"
              className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-amber-950"
            >
              わたしの傾向を作る
            </a>
          )}
        </section>
      )}

      {invitationState.status === "success" ? (
        <section className="mt-8 rounded-3xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-700 dark:bg-emerald-950/30">
          <h2 className="flex items-center gap-2 font-bold text-emerald-950 dark:text-emerald-100">
            <CheckCircle2 className="size-5" aria-hidden="true" />
            招待リンクを発行しました
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
            このリンクは1人が承諾すると使用済みになります。有効期限は
            {new Date(invitationState.data.expiresAt).toLocaleDateString("ja-JP")}です。
          </p>
          <p className="mt-3 break-all rounded-xl bg-white/80 p-3 text-xs text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
            {invitationState.data.invitationUrl}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onShareToLine(invitationState.data.invitationUrl)}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#06c755] px-5 py-3 font-bold text-white"
            >
              <MessageCircle className="size-5" aria-hidden="true" />
              LINEで送る
            </button>
            <button
              type="button"
              onClick={() => onCopyLink(invitationState.data.invitationUrl)}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-emerald-400 bg-white px-5 py-3 font-bold text-emerald-900 dark:bg-slate-950 dark:text-emerald-100"
            >
              <Copy className="size-5" aria-hidden="true" />
              リンクをコピー
            </button>
          </div>
          {sharingMessage && (
            <output className="mt-3 block text-center text-sm text-slate-700 dark:text-slate-300">
              {sharingMessage}
            </output>
          )}
        </section>
      ) : (
        <>
          {invitationState.status === "error" && (
            <div
              role="alert"
              className="mt-8 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200"
            >
              <p>{invitationState.message}</p>
              <button type="button" onClick={onRetryPreview} className="mt-2 font-bold underline">
                共有内容を再読み込み
              </button>
            </div>
          )}
          <button
            type="button"
            disabled={!preview.canIssueInvitation || invitationState.status === "loading"}
            onClick={() => onIssue(preview.previewToken)}
            className="mt-8 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
          >
            {invitationState.status === "loading" ? (
              <LoaderCircle
                className="size-5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Send className="size-5" aria-hidden="true" />
            )}
            {invitationState.status === "loading"
              ? "招待リンクを発行中"
              : preview.canIssueInvitation
                ? "招待リンクを発行する"
                : "招待リンクを発行できません"}
          </button>
        </>
      )}
    </>
  );
}

export function CompatibilityShareScreen({
  invitationState = { status: "idle" },
  onCopyLink = () => undefined,
  onIssue = () => undefined,
  onRetry,
  onShareToLine = () => undefined,
  sharingMessage = null,
  state,
}: {
  invitationState?: AsyncState<CompatibilityInvitation>;
  onCopyLink?: (url: string) => void;
  onIssue?: (previewToken: string) => void;
  onRetry: () => void;
  onShareToLine?: (url: string) => void;
  sharingMessage?: string | null;
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
      {state.status === "success" && (
        <SharePreviewContent
          preview={state.data}
          invitationState={invitationState}
          sharingMessage={sharingMessage}
          onCopyLink={onCopyLink}
          onIssue={onIssue}
          onRetryPreview={onRetry}
          onShareToLine={onShareToLine}
        />
      )}
    </main>
  );
}
