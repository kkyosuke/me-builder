import {
  AlertCircle,
  CheckCircle2,
  Copy,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Send,
} from "lucide-react";
import type { AsyncState } from "../../../model/async-state";
import type { CompatibilityInvitation } from "../model/compatibility-invitation";
import type {
  CompatibilityShareConsent,
  CompatibilityShareConsentBlockingReason,
} from "../model/compatibility-share-consent";
import { CompatibilityPrivacyNotice } from "./components/compatibility-disclosure";
import { CompatibilityShareScope } from "./components/compatibility-share-content";
import { CompatibilityBackHeader, CompatibilityProfileAvatar } from "./components/compatibility-ui";

const blockingReasonMessages: Record<CompatibilityShareConsentBlockingReason, string> = {
  display_name_unavailable: "LINEの表示名を確認できませんでした。",
};

const nextActionGuides = {
  diagnosis: {
    message: "診断に答えると、2人で比べられるテーマが増えます。",
    href: "/diagnosis",
    label: "診断を始める",
  },
  "profile-summary": {
    message: "「わたしのまとめ」ができると、「私について」も共有されます。",
    href: "/me",
    label: "わたしの傾向を作る",
  },
} as const;

function ShareConsentSkeleton() {
  return (
    <output
      aria-label="共有の確認を読み込み中"
      aria-live="polite"
      className="mt-8 block animate-pulse space-y-3 motion-reduce:animate-none"
    >
      <span className="sr-only">共有の確認を読み込んでいます</span>
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

function ShareConsentContent({
  consent,
  invitationState,
  onCopyLink,
  onIssue,
  onRetryConsent,
  onShareToLine,
  isSharing,
  sharingMessage,
}: {
  consent: CompatibilityShareConsent;
  invitationState: AsyncState<CompatibilityInvitation>;
  onCopyLink: (url: string) => void;
  onIssue: () => void;
  onRetryConsent: () => void;
  onShareToLine: (url: string) => void;
  isSharing: boolean;
  sharingMessage: string | null;
}) {
  const displayName = consent.displayName ?? "あなた";
  const guide = consent.nextAction ? nextActionGuides[consent.nextAction] : null;

  return (
    <>
      <div className="mt-5 flex items-center gap-4">
        <CompatibilityProfileAvatar
          imageUrl={consent.avatarUrl}
          displayName={displayName}
          tone="sky"
        />
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
        この相手とうつしをシェアしていいかだけを確認します。共有した後は、増えた分も自動で共有されます。共有される内容は「わたし」からいつでも確認できます。
      </p>

      <CompatibilityShareScope headingId="share-scope-heading" />

      <CompatibilityPrivacyNotice
        title="共有されない詳細"
        footer="相手が承諾するまで、共有は始まりません。共有は後から終了できます。"
        status={
          invitationState.status === "success" ? (
            <div className="flex items-start gap-2 text-emerald-950 dark:text-emerald-100">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h3 className="font-bold">招待リンクを発行しました</h3>
                <p className="mt-2 text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
                  このリンクは1人が承諾すると使用済みになります。有効期限は
                  {new Date(invitationState.data.expiresAt).toLocaleDateString("ja-JP")}です。
                </p>
                <p className="mt-3 break-all rounded-xl bg-white/80 p-3 text-xs text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
                  {invitationState.data.invitationUrl}
                </p>
                {sharingMessage && (
                  <output className="mt-3 block text-sm text-slate-700 dark:text-slate-300">
                    {sharingMessage}
                  </output>
                )}
              </div>
            </div>
          ) : undefined
        }
      />

      {guide && (
        <section className="mt-8 rounded-2xl border border-sky-300/60 bg-sky-50 p-4 dark:border-sky-500/30 dark:bg-sky-950/30">
          <p className="text-sm leading-relaxed text-sky-950 dark:text-sky-100">{guide.message}</p>
          <a
            href={guide.href}
            className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-sky-300 px-4 py-2 text-sm font-bold text-sky-950"
          >
            {guide.label}
          </a>
        </section>
      )}

      {consent.blockingReasons.length > 0 && (
        <section className="mt-8 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-950/30">
          <h2 className="flex items-center gap-2 font-bold text-amber-950 dark:text-amber-100">
            <AlertCircle className="size-5" aria-hidden="true" />
            招待リンクを発行する前に
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900 dark:text-amber-200">
            {consent.blockingReasons.map((reason) => (
              <li key={reason}>・{blockingReasonMessages[reason]}</li>
            ))}
          </ul>
        </section>
      )}

      {invitationState.status === "error" && (
        <div
          role="alert"
          className="mt-8 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200"
        >
          <p>{invitationState.message}</p>
          <button type="button" onClick={onRetryConsent} className="mt-2 font-bold underline">
            共有の確認を再読み込み
          </button>
        </div>
      )}

      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto w-full max-w-2xl px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
          {invitationState.status === "success" ? (
            <div className="grid h-12 grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSharing}
                onClick={() => onShareToLine(invitationState.data.invitationUrl)}
                className="flex h-12 min-w-0 items-center justify-center gap-2 rounded-2xl bg-[#06c755] px-2 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
              >
                {isSharing ? (
                  <LoaderCircle
                    className="size-5 shrink-0 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <MessageCircle className="size-5 shrink-0" aria-hidden="true" />
                )}
                {isSharing ? "共有先を開いています" : "友だちに送る"}
              </button>
              <button
                type="button"
                onClick={() => onCopyLink(invitationState.data.invitationUrl)}
                className="flex h-12 min-w-0 items-center justify-center gap-2 rounded-2xl border border-emerald-400 bg-white px-2 text-sm font-bold text-emerald-900 dark:bg-slate-950 dark:text-emerald-100"
              >
                <Copy className="size-5 shrink-0" aria-hidden="true" />
                コピー
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!consent.canShare || invitationState.status === "loading"}
              onClick={onIssue}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
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
                : consent.canShare
                  ? "共有して招待リンクを発行する"
                  : "招待リンクを発行できません"}
            </button>
          )}
        </div>
      </footer>
    </>
  );
}

export function CompatibilityShareScreen({
  invitationState = { status: "idle" },
  onCopyLink = () => undefined,
  onIssue = () => undefined,
  onRetry,
  onShareToLine = () => undefined,
  isSharing = false,
  sharingMessage = null,
  state,
}: {
  invitationState?: AsyncState<CompatibilityInvitation>;
  onCopyLink?: (url: string) => void;
  onIssue?: () => void;
  onRetry: () => void;
  onShareToLine?: (url: string) => void;
  isSharing?: boolean;
  sharingMessage?: string | null;
  state: AsyncState<CompatibilityShareConsent>;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pt-6 pb-28 sm:px-8">
      <CompatibilityBackHeader />
      {(state.status === "idle" || state.status === "loading") && <ShareConsentSkeleton />}
      {state.status === "error" && (
        <section className="mt-8 rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center">
          <p className="font-bold text-red-700 dark:text-red-300">
            共有の確認を表示できませんでした
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
        <ShareConsentContent
          consent={state.data}
          invitationState={invitationState}
          sharingMessage={sharingMessage}
          onCopyLink={onCopyLink}
          onIssue={onIssue}
          onRetryConsent={onRetry}
          onShareToLine={onShareToLine}
          isSharing={isSharing}
        />
      )}
    </main>
  );
}
