import { AlertCircle, HeartHandshake, RefreshCw } from "lucide-react";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import type {
  CompatibilityInvitationPreview,
  CompatibilityInvitationPreviewBlockingReason,
} from "../model/compatibility-invitation-preview";
import type { CompatibilityInvitationAcceptance } from "../model/compatibility-relationship";
import { CompatibilityPrivacyNotice } from "./components/compatibility-disclosure";
import {
  CompatibilityAboutMePreview,
  CompatibilityThemesPreview,
} from "./components/compatibility-share-content";
import { CompatibilityBackHeader, CompatibilityProfileAvatar } from "./components/compatibility-ui";

const blockingReasonMessages: Record<CompatibilityInvitationPreviewBlockingReason, string> = {
  display_name_unavailable: "LINEの表示名を確認できませんでした。",
  profile_summary_required: "共有用の「私について」がまだ作成されていません。",
  profile_summary_stale: "共有用の「私について」に更新が必要です。",
  diagnosis_required: "共有できる診断結果がまだありません。",
  scoring_unavailable: "一部の診断結果を共有用に準備できませんでした。",
  diagnosis_unavailable: "診断情報を読み込めませんでした。時間をおいて再度お試しください。",
  common_diagnosis_required: "2人とも確認できる共通の診断テーマがまだありません。",
};

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
      {["about", "themes", "privacy"].map((key) => (
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
  onAccept: (previewToken: string) => void;
}) {
  const inviterName = invitation.inviter.displayName;

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
        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-50">
          2人の相性を見てみませんか？
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          診断から見える範囲で、お互いの大切にしたいことを資料にまとめます。
        </p>
        <p className="mt-3 text-xs text-slate-500">
          招待の有効期限: {new Date(invitation.expiresAt).toLocaleDateString("ja-JP")}
        </p>
      </section>

      <CompatibilityAboutMePreview
        eyebrow={`${inviterName}さんが共有する「私について」`}
        headingId="inviter-about-me-heading"
        profile={invitation.inviter.aboutMe}
      />
      <CompatibilityThemesPreview
        eyebrow={`${inviterName}さんが共有する診断テーマ`}
        headingId="inviter-themes-heading"
        themes={invitation.inviter.themes}
      />

      {invitation.recipient.aboutMe && (
        <CompatibilityAboutMePreview
          eyebrow={`${inviterName}さんに見える、あなたの「私について」`}
          headingId="recipient-about-me-heading"
          profile={invitation.recipient.aboutMe}
        />
      )}
      {invitation.recipient.themes.length > 0 && (
        <CompatibilityThemesPreview
          eyebrow={`${inviterName}さんとの比較に使う共通テーマ`}
          headingId="recipient-themes-heading"
          themes={invitation.recipient.themes}
          countLabel={`${invitation.recipient.themes.length}テーマが共通`}
        />
      )}

      <CompatibilityPrivacyNotice
        title="共有されない詳細"
        footer="相性を見てみることへ承諾するまで、あなたの情報は相手へ共有されません。"
      />

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
          {invitation.nextAction && (
            <a
              href={invitation.nextAction === "profile-summary" ? "/me" : "/diagnosis"}
              className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-amber-950"
            >
              {invitation.nextAction === "profile-summary" ? "わたしの傾向を作る" : "診断を見る"}
            </a>
          )}
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
          onClick={() => onAccept(invitation.recipient.previewToken)}
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
  onAccept?: (previewToken: string) => void;
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
