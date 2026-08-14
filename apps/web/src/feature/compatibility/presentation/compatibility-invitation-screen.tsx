import { AlertCircle, HeartHandshake, RefreshCw } from "lucide-react";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import {
  getRelationshipCategoryBadgeClassName,
  getRelationshipCategoryLabel,
} from "../../diagnosis/model/relationship-category";
import type {
  CompatibilityInvitationPreview,
  CompatibilityInvitationPreviewBlockingReason,
} from "../model/compatibility-invitation-preview";
import type { CompatibilityInvitationAcceptance } from "../model/compatibility-relationship";
import { CompatibilityPrivacyNotice } from "./components/compatibility-disclosure";
import { CompatibilityShareScope } from "./components/compatibility-share-content";
import { CompatibilityBackHeader, CompatibilityProfileAvatar } from "./components/compatibility-ui";

const blockingReasonMessages: Record<CompatibilityInvitationPreviewBlockingReason, string> = {
  display_name_unavailable: "LINEの表示名を確認できませんでした。",
};

const nextActionGuides = {
  diagnosis: {
    message: "診断に答えると、2人で比べられるテーマが増えます。",
    href: "/diagnosis",
    label: "診断を見る",
  },
  "profile-summary": {
    message: "「わたしのまとめ」ができると、あなたの「私について」も共有されます。",
    href: "/me",
    label: "わたしの傾向を作る",
  },
} as const;

function InvitationSkeleton() {
  return (
    <SkeletonLoader label="招待内容を読み込み中" className="mt-5">
      <div className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800">
        <div className="flex justify-center gap-4">
          <SkeletonBlock className="size-20 rounded-3xl" />
          <SkeletonBlock className="size-20 rounded-3xl" />
        </div>
        <SkeletonBlock className="mx-auto mt-5 h-5 w-40 rounded-full" />
        <SkeletonBlock className="mx-auto mt-3 h-8 w-64 rounded-full" />
      </div>
      {["scope", "privacy"].map((key) => (
        <SkeletonBlock key={key} className="mt-5 h-40 w-full rounded-3xl" />
      ))}
    </SkeletonLoader>
  );
}

function InvitationError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="mt-8 rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center">
      <AlertCircle className="mx-auto size-8 text-red-600 dark:text-red-300" aria-hidden="true" />
      <h1 className="mt-3 text-xl font-bold text-red-800 dark:text-red-200">
        招待内容を表示できませんでした
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-300 px-4 py-2 text-sm font-bold text-red-950"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        再試行
      </button>
      <a
        href="/compatibility"
        className="mt-3 flex min-h-11 items-center justify-center text-sm font-bold text-slate-500"
      >
        相性一覧へ戻る
      </a>
    </section>
  );
}

function InvitationContents({
  acceptanceState,
  invitation,
  onAccept,
}: {
  acceptanceState: AsyncState<CompatibilityInvitationAcceptance>;
  invitation: CompatibilityInvitationPreview;
  onAccept: () => void;
}) {
  const inviterName = invitation.inviter.displayName;
  const guide = invitation.nextAction ? nextActionGuides[invitation.nextAction] : null;

  return (
    <>
      <section className="mt-5 rounded-3xl border border-violet-300/30 bg-gradient-to-br from-violet-50 via-white to-rose-50 p-5 text-center dark:from-violet-950/30 dark:via-slate-800 dark:to-rose-950/30">
        <div className="flex items-center justify-center gap-3">
          <CompatibilityProfileAvatar
            imageUrl={invitation.inviter.avatarUrl}
            displayName={inviterName}
            tone="violet"
          />
          <HeartHandshake className="size-7 text-rose-500" aria-hidden="true" />
          <CompatibilityProfileAvatar
            imageUrl={invitation.recipient.avatarUrl}
            displayName={invitation.recipient.displayName ?? "あなた"}
            tone="sky"
          />
        </div>
        <p className="mt-5 text-sm font-semibold text-violet-700 dark:text-violet-300">
          {inviterName}さんから招待が届いています
        </p>
        <p
          className={`mx-auto mt-3 w-fit rounded-full px-3 py-1.5 text-sm font-bold ${getRelationshipCategoryBadgeClassName(invitation.relationshipCategory)}`}
        >
          関係: {getRelationshipCategoryLabel(invitation.relationshipCategory)}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-50">
          2人の相性を見てみませんか？
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {getRelationshipCategoryLabel(invitation.relationshipCategory)}
          としての診断と、人間関係全般の診断から見える範囲で、お互いの大切にしたいことを資料にまとめます。承諾すると、これから増える分もお互いへ自動で共有されます。
        </p>
        <p className="mt-3 text-xs text-slate-500">
          招待の有効期限: {new Date(invitation.expiresAt).toLocaleDateString("ja-JP")}
        </p>
      </section>

      <CompatibilityShareScope headingId="share-scope-heading" />

      <CompatibilityPrivacyNotice
        title="共有されない詳細"
        footer="相性を見てみることへ承諾するまで、あなたの情報は相手へ共有されません。"
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

      {invitation.blockingReasons.length > 0 && (
        <section className="mt-8 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-950/30">
          <h2 className="flex items-center gap-2 font-bold text-amber-950 dark:text-amber-100">
            <AlertCircle className="size-5" aria-hidden="true" />
            相性を見る前に
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900 dark:text-amber-200">
            {invitation.blockingReasons.map((reason) => (
              <li key={reason}>・{blockingReasonMessages[reason]}</li>
            ))}
          </ul>
        </section>
      )}

      {acceptanceState.status === "success" ? (
        <section className="mt-8 rounded-3xl border border-emerald-300 bg-emerald-50 p-5 text-center dark:bg-emerald-950/30">
          <h2 className="font-bold text-emerald-950 dark:text-emerald-100">
            2人の相性シートを作りました
          </h2>
          <a
            href={`/compatibility/relationships/${acceptanceState.data.relationshipId}`}
            className="mt-4 flex min-h-12 items-center justify-center rounded-2xl bg-emerald-600 px-5 font-bold text-white"
          >
            相性シートを見る
          </a>
        </section>
      ) : (
        <button
          type="button"
          disabled={!invitation.canAccept || acceptanceState.status === "loading"}
          onClick={onAccept}
          className="mt-8 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
        >
          <HeartHandshake className="size-5" aria-hidden="true" />
          {acceptanceState.status === "loading"
            ? "相性シートを作っています..."
            : invitation.canAccept
              ? "相性を見てみる"
              : "相性をまだ見られません"}
        </button>
      )}
      {acceptanceState.status === "error" && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300"
        >
          {acceptanceState.message}
        </p>
      )}
      <a
        href="/compatibility"
        className="mt-3 flex min-h-11 items-center justify-center text-sm font-bold text-slate-500"
      >
        今は承諾しない
      </a>
    </>
  );
}

export function CompatibilityInvitationScreen({
  acceptanceState = { status: "idle" },
  onAccept = () => undefined,
  onRetry,
  state,
}: {
  acceptanceState?: AsyncState<CompatibilityInvitationAcceptance>;
  onAccept?: () => void;
  onRetry: () => void;
  state: AsyncState<CompatibilityInvitationPreview>;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 pb-12 sm:px-8">
      <CompatibilityBackHeader href="/compatibility" label="閉じる" />
      {(state.status === "idle" || state.status === "loading") && <InvitationSkeleton />}
      {state.status === "error" && <InvitationError message={state.message} onRetry={onRetry} />}
      {state.status === "success" && (
        <InvitationContents
          invitation={state.data}
          acceptanceState={acceptanceState}
          onAccept={onAccept}
        />
      )}
    </main>
  );
}
