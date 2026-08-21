import {
  type CompatibilityRelationshipCategory,
  compatibilityRelationshipCategoryValues,
} from "@me-builder/lib/compatibility";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Send,
} from "lucide-react";
import { InternalLink } from "../../../components/internal-link";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import {
  diagnosisCategoryHref,
  getRelationshipCategoryLabel,
} from "../../diagnosis/model/relationship-category";
import { compatibilityShareContentHref } from "../model/compatibility-category-navigation";
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

const categorySelectorClassNames: Record<
  CompatibilityRelationshipCategory,
  { mark: string; focus: string; selected: string }
> = {
  partner: {
    mark: "bg-rose-500 ring-rose-500",
    focus: "focus-within:ring-rose-500",
    selected:
      "border-rose-500 bg-rose-100 text-rose-800 ring-rose-500/20 dark:border-rose-500 dark:bg-rose-950 dark:text-rose-200",
  },
  family: {
    mark: "bg-amber-500 ring-amber-500",
    focus: "focus-within:ring-amber-500",
    selected:
      "border-amber-500 bg-amber-100 text-amber-800 ring-amber-500/20 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-200",
  },
  friend: {
    mark: "bg-emerald-500 ring-emerald-500",
    focus: "focus-within:ring-emerald-500",
    selected:
      "border-emerald-500 bg-emerald-100 text-emerald-800 ring-emerald-500/20 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-200",
  },
  work: {
    mark: "bg-blue-500 ring-blue-500",
    focus: "focus-within:ring-blue-500",
    selected:
      "border-blue-500 bg-blue-100 text-blue-800 ring-blue-500/20 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-200",
  },
};

const nextActionGuides = {
  diagnosis: {
    message: "診断に答えると、2人で比べられるテーマが増えます。",
    label: "診断を始める",
  },
  "profile-summary": {
    message: "「わたしのまとめ」ができると、「私について」も共有されます。",
    label: "わたしの傾向を作る",
  },
} as const;

function ShareConsentProfile({
  onRetry,
  state,
}: {
  onRetry: () => void;
  state: AsyncState<CompatibilityShareConsent>;
}) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <SkeletonLoader label="共有者の情報を読み込み中" className="mt-5">
        <div className="flex min-h-20 items-center gap-4">
          <SkeletonBlock className="size-20 shrink-0 rounded-full" />
          <SkeletonBlock className="h-5 w-36 rounded-full" />
        </div>
      </SkeletonLoader>
    );
  }

  if (state.status === "error") {
    return (
      <section role="alert" className="mt-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4">
        <p className="font-bold text-red-700 dark:text-red-300">
          共有者の情報を確認できませんでした
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {state.message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-300 px-4 py-2 text-sm font-semibold text-slate-950"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          再試行
        </button>
      </section>
    );
  }

  const displayName = state.data.displayName ?? "あなた";
  return (
    <div className="mt-5 flex min-h-20 items-center gap-4">
      <CompatibilityProfileAvatar
        imageUrl={state.data.avatarUrl}
        displayName={displayName}
        tone="sky"
      />
      <p className="text-sm font-semibold tracking-wider text-rose-700 dark:text-rose-300">
        {displayName}さんから招待
      </p>
    </div>
  );
}

function RelationshipCategorySelector({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (category: CompatibilityRelationshipCategory) => void;
  value: CompatibilityRelationshipCategory | null;
}) {
  return (
    <fieldset className="mt-7" disabled={disabled}>
      <legend className="w-full">
        <span className="flex w-full items-baseline justify-between gap-3">
          <span className="font-bold text-slate-950 dark:text-slate-50">相手との関係</span>
          <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
            {value === null ? "一つ選択してください" : "必要なら変更できます"}
          </span>
        </span>
      </legend>
      <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        選んだ関係に合う診断と、人間関係全般の診断を2人の相性に使います。
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {compatibilityRelationshipCategoryValues.map((category) => {
          const selected = value === category;
          const selectorClassName = categorySelectorClassNames[category];
          return (
            <label
              key={category}
              className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded-2xl border px-3 py-2 text-sm font-bold transition focus-within:ring-2 focus-within:ring-offset-2 ${selectorClassName.focus} ${
                selected
                  ? `ring-2 ${selectorClassName.selected}`
                  : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
            >
              <input
                type="radio"
                name="relationship-category"
                value={category}
                checked={selected}
                onChange={() => onChange(category)}
                className={`size-5 shrink-0 appearance-none rounded-full ${
                  selected
                    ? `border-[5px] border-white ring-1 ${selectorClassName.mark}`
                    : "border-2 border-slate-400 bg-white dark:border-slate-500 dark:bg-slate-800"
                }`}
              />
              <span>{getRelationshipCategoryLabel(category)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ShareConsentContent({
  invitationState,
  onCopyLink,
  onIssue,
  onRetryConsent,
  onShareToLine,
  isSharing,
  sharingMessage,
  relationshipCategory,
  onRelationshipCategoryChange,
  state,
}: {
  invitationState: AsyncState<CompatibilityInvitation>;
  onCopyLink: (url: string) => void;
  onIssue: () => void;
  onRetryConsent: () => void;
  onShareToLine: (url: string) => void;
  isSharing: boolean;
  sharingMessage: string | null;
  relationshipCategory: CompatibilityRelationshipCategory | null;
  onRelationshipCategoryChange: (category: CompatibilityRelationshipCategory) => void;
  state: AsyncState<CompatibilityShareConsent>;
}) {
  const consent = state.status === "success" ? state.data : null;
  const guide = consent?.nextAction ? nextActionGuides[consent.nextAction] : null;
  const guideHref =
    consent?.nextAction === "diagnosis" && relationshipCategory
      ? diagnosisCategoryHref(relationshipCategory)
      : compatibilityShareContentHref(relationshipCategory ?? "partner");
  const shareContentHref = compatibilityShareContentHref(relationshipCategory ?? "partner");

  return (
    <>
      <h1
        tabIndex={-1}
        data-compatibility-route-heading="share"
        className="mt-5 text-3xl font-bold text-slate-950 focus:outline-none dark:text-slate-50"
      >
        うつしをシェア
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        この相手とうつしをシェアしていいかだけを確認します。共有した後は、増えた分も自動で共有されます。共有される内容は
        <InternalLink
          href={shareContentHref}
          preloadRoute="me"
          className="font-bold text-sky-700 underline underline-offset-4 dark:text-sky-300"
        >
          「わたし」
        </InternalLink>
        からいつでも確認できます。
      </p>

      <ShareConsentProfile state={state} onRetry={onRetryConsent} />

      <RelationshipCategorySelector
        value={relationshipCategory}
        disabled={
          state.status !== "success" ||
          invitationState.status === "loading" ||
          invitationState.status === "success"
        }
        onChange={onRelationshipCategoryChange}
      />

      <CompatibilityShareScope headingId="share-scope-heading" />

      <section className="mt-6 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-bold">招待リンクを送る相手を確認してください</p>
        <p className="mt-1">
          リンクを受け取ってログインした人は誰でも承諾できます。送りたい相手以外へ転送しないでください。最初に1人が承諾すると、リンクは使用済みになります。
        </p>
      </section>

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
          <InternalLink
            href={guideHref}
            preloadRoute={consent?.nextAction === "diagnosis" ? "diagnosis" : "me"}
            className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-sky-300 px-4 py-2 text-sm font-bold text-sky-950"
          >
            {guide.label}
          </InternalLink>
        </section>
      )}
      {consent && consent.blockingReasons.length > 0 && (
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
              disabled={
                !consent?.canShare ||
                relationshipCategory === null ||
                invitationState.status === "loading"
              }
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
                : consent && !consent.canShare
                  ? "招待リンクを発行できません"
                  : "共有して招待リンクを発行する"}
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
  relationshipCategory = "partner",
  onRelationshipCategoryChange = () => undefined,
  state,
}: {
  invitationState?: AsyncState<CompatibilityInvitation>;
  onCopyLink?: (url: string) => void;
  onIssue?: () => void;
  onRetry: () => void;
  onShareToLine?: (url: string) => void;
  isSharing?: boolean;
  sharingMessage?: string | null;
  relationshipCategory?: CompatibilityRelationshipCategory | null;
  onRelationshipCategoryChange?: (category: CompatibilityRelationshipCategory) => void;
  state: AsyncState<CompatibilityShareConsent>;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pt-6 pb-28 sm:px-8">
      <CompatibilityBackHeader />
      <ShareConsentContent
        state={state}
        invitationState={invitationState}
        sharingMessage={sharingMessage}
        relationshipCategory={relationshipCategory}
        onRelationshipCategoryChange={onRelationshipCategoryChange}
        onCopyLink={onCopyLink}
        onIssue={onIssue}
        onRetryConsent={onRetry}
        onShareToLine={onShareToLine}
        isSharing={isSharing}
      />
    </main>
  );
}
