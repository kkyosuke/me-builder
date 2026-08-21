import {
  ArrowLeft,
  Brain,
  ChevronRight,
  CreditCard,
  FileText,
  Images,
  Moon,
  Plug,
  RefreshCw,
  Shield,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type AsyncState, errorMessage } from "../../../model/async-state";
import type { SsoIdentityCallbackResult } from "../../auth/infrastructure/sso-auth-adapter";
import type { ColorTheme } from "../../theme/model/color-theme";
import type { FontSize } from "../../theme/model/font-size";
import type { ResetDevelopmentAccountDataResult } from "../infrastructure/development-account-data-api";
import type { SsoIdentityStatus } from "../infrastructure/sso-identity-api";
import { type AvatarSelection, getAvatarName } from "../model/avatar";
import type { ProfileEntitlement } from "../model/entitlement";
import { AvatarPreview } from "./components/avatar-preview";

const themes = [
  {
    id: "light",
    name: "ライト",
    description: "明るく、やわらかな表示",
    icon: Sun,
    iconClassName: "bg-amber-100 text-amber-700",
  },
  {
    id: "dark",
    name: "ダーク",
    description: "暗い場所でも見やすい表示",
    icon: Moon,
    iconClassName: "bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200",
  },
] as const;

const fontSizes = [
  { id: "small", name: "小" },
  { id: "medium", name: "中" },
  { id: "large", name: "大" },
] as const;

export function ProfileSettingsScreen({
  avatar,
  isAdmin = false,
  isInactive = false,
  inactiveFocusTarget = "avatar",
  isProfileLoading = false,
  profileError = null,
  entitlement,
  linePictureUrl,
  theme,
  fontSize,
  onBack,
  onOpenAdmin,
  onOpenMcp,
  onOpenAvatar,
  onOpenPhotoDiary = () => undefined,
  onOpenBillingPortal,
  onOpenBillingPlans,
  onOpenPersonalData,
  onOpenFamily,
  canOpenBrainItems = false,
  onOpenBrainItems,
  onRetryProfile,
  canResetAccountData = false,
  onResetAccountData,
  onThemeChange,
  onFontSizeChange,
  serviceTermsAcceptanceHistory,
  onIssueRecoveryCode,
  ssoIdentity,
  ssoIdentityCallbackResult,
  onLinkSsoIdentity,
  onUnlinkSsoIdentity,
}: {
  avatar: AvatarSelection | null;
  isAdmin?: boolean;
  isInactive?: boolean;
  inactiveFocusTarget?: "avatar" | "brain-items" | "billing" | "mcp" | "photos";
  isProfileLoading?: boolean;
  profileError?: string | null;
  entitlement?: AsyncState<ProfileEntitlement>;
  linePictureUrl?: string | undefined;
  theme: ColorTheme;
  fontSize: FontSize;
  onBack: () => void;
  onOpenAdmin?: () => void;
  onOpenMcp?: () => void;
  onOpenAvatar: () => void;
  onOpenPhotoDiary?: () => void;
  onOpenBillingPortal?: () => Promise<void>;
  onOpenBillingPlans?: () => void;
  onOpenPersonalData?: () => void;
  onOpenFamily?: () => void;
  canOpenBrainItems?: boolean;
  onOpenBrainItems?: () => void;
  onRetryProfile?: () => void;
  canResetAccountData?: boolean;
  onResetAccountData?: () => Promise<ResetDevelopmentAccountDataResult>;
  onThemeChange: (theme: ColorTheme) => void;
  onFontSizeChange: (fontSize: FontSize) => void;
  serviceTermsAcceptanceHistory?: ReactNode;
  onIssueRecoveryCode?: () => Promise<{ code: string; expiresAt: string }>;
  ssoIdentity?: AsyncState<SsoIdentityStatus>;
  ssoIdentityCallbackResult?: SsoIdentityCallbackResult;
  onLinkSsoIdentity?: () => Promise<void>;
  onUnlinkSsoIdentity?: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const photoDiaryButtonRef = useRef<HTMLButtonElement>(null);
  const brainItemsLinkRef = useRef<HTMLAnchorElement>(null);
  const billingPlansButtonRef = useRef<HTMLButtonElement>(null);
  const mcpLinkRef = useRef<HTMLAnchorElement>(null);
  const wasInactiveRef = useRef(isInactive);
  const inactiveFocusTargetRef = useRef(inactiveFocusTarget);
  const [resetState, setResetState] = useState<AsyncState<string>>({ status: "idle" });
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [recoveryCodeState, setRecoveryCodeState] = useState<
    AsyncState<{ code: string; expiresAt: string }>
  >({ status: "idle" });
  const [billingState, setBillingState] = useState<AsyncState<string>>({ status: "idle" });
  const [ssoMutationState, setSsoMutationState] = useState<AsyncState<string>>({ status: "idle" });

  const planDate =
    entitlement?.status === "success"
      ? entitlement.data.source === "free"
        ? { label: "AI利用枠リセット", value: entitlement.data.aiReply.resetsAt }
        : {
            label: "利用可能期限",
            value: entitlement.data.availableUntil,
          }
      : null;

  const openBillingPortal = useCallback(async () => {
    if (!onOpenBillingPortal) return;
    setBillingState({ status: "loading" });
    try {
      await onOpenBillingPortal();
    } catch (error) {
      setBillingState({
        status: "error",
        message: errorMessage(error, "契約管理を開けませんでした。"),
      });
    }
  }, [onOpenBillingPortal]);

  const resetAccountData = useCallback(async () => {
    if (!onResetAccountData || !resetConfirmed) return;
    setResetState({ status: "loading" });
    try {
      const deleted = await onResetAccountData();
      const contentCount =
        deleted.deletedDiagnosisResponseCount +
        deleted.deletedConversationSessionCount +
        deleted.deletedSourceRecordCount +
        deleted.deletedBrainItemCount +
        deleted.deletedProfileSummaryVersionCount;
      setResetState({
        status: "success",
        data:
          contentCount === 0 && deleted.scheduledVectorDeletionCount === 0
            ? "削除対象の本人データはありませんでした。"
            : `本人データを削除しました（${contentCount}件）。Vector ${deleted.scheduledVectorDeletionCount}件の削除を受け付けました。`,
      });
      setResetConfirmed(false);
    } catch (error) {
      setResetState({
        status: "error",
        message: errorMessage(error, "本人データを削除できませんでした。"),
      });
    }
  }, [onResetAccountData, resetConfirmed]);

  useEffect(() => {
    dialogRef.current?.toggleAttribute("inert", isInactive);
    if (isInactive) {
      wasInactiveRef.current = true;
      inactiveFocusTargetRef.current = inactiveFocusTarget;
      return;
    }

    if (wasInactiveRef.current) {
      if (inactiveFocusTargetRef.current === "photos") {
        photoDiaryButtonRef.current?.focus();
      } else if (inactiveFocusTargetRef.current === "mcp") {
        mcpLinkRef.current?.focus();
      } else if (inactiveFocusTargetRef.current === "billing") {
        billingPlansButtonRef.current?.focus();
      } else if (inactiveFocusTargetRef.current === "brain-items") {
        brainItemsLinkRef.current?.focus();
      } else {
        avatarButtonRef.current?.focus();
      }
    } else {
      backButtonRef.current?.focus();
    }
    wasInactiveRef.current = false;
  }, [inactiveFocusTarget, isInactive]);

  return (
    <dialog
      ref={dialogRef}
      open
      aria-modal="true"
      aria-labelledby="profile-settings-title"
      aria-hidden={isInactive || undefined}
      className="fixed inset-0 z-[60] m-0 h-auto max-h-none w-auto max-w-none overflow-y-auto border-0 bg-slate-50 p-0 dark:bg-slate-900"
    >
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center px-4 sm:px-8">
          <button
            ref={backButtonRef}
            type="button"
            onClick={onBack}
            className="inline-flex size-11 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="プロフィールを閉じる"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <h1
            id="profile-settings-title"
            className="ml-2 text-lg font-bold text-slate-950 dark:text-white"
          >
            プロフィール
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16 sm:px-8">
        <section
          aria-labelledby="profile-appearance-heading"
          className="overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-white to-violet-100 p-5 shadow-lg shadow-slate-950/5 sm:p-6 dark:from-sky-950/60 dark:via-slate-800 dark:to-violet-950/50"
        >
          <div className="flex items-center gap-4">
            <AvatarPreview avatar={avatar} fallbackImageUrl={linePictureUrl} size="lg" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-violet-700 dark:text-violet-200">
                <Sparkles className="size-4" aria-hidden="true" />
                YOUR PROFILE
              </p>
              <h2
                id="profile-appearance-heading"
                className="mt-2 text-2xl font-bold text-slate-950 dark:text-white"
              >
                あなたらしい見た目に
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                アバターと画面の見やすさをここで整えられます。
              </p>
            </div>
          </div>
        </section>

        {onOpenBillingPortal &&
          entitlement?.status === "success" &&
          entitlement.data.source === "subscription" && (
            <section aria-labelledby="billing-setting-heading" className="mt-6">
              <h2
                id="billing-setting-heading"
                className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
              >
                契約とお支払い
              </h2>
              <button
                type="button"
                onClick={() => void openBillingPortal()}
                disabled={billingState.status === "loading"}
                className="mt-3 flex min-h-16 w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300 hover:bg-sky-50/50 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-700 dark:hover:bg-sky-950/20"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">
                  <CreditCard className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-slate-950 dark:text-white">
                    {billingState.status === "loading" ? "契約管理を開いています..." : "契約を管理"}
                  </span>
                  <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                    支払方法、請求履歴、解約を確認
                  </span>
                </span>
                <ChevronRight className="size-5 text-slate-400" aria-hidden="true" />
              </button>
              {billingState.status === "error" && (
                <p role="alert" className="mt-3 px-1 text-sm text-rose-700 dark:text-rose-300">
                  {billingState.message}
                </p>
              )}
            </section>
          )}

        {entitlement && (
          <section aria-labelledby="subscription-heading" className="mt-6">
            <h2
              id="subscription-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              利用プラン
            </h2>
            {entitlement.status === "loading" || entitlement.status === "idle" ? (
              <output
                aria-busy="true"
                aria-label="利用プランを読み込んでいます"
                className="mt-3 block h-28 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-700"
              />
            ) : entitlement.status === "error" ? (
              <p
                role="alert"
                className="mt-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-900 dark:bg-rose-400/10 dark:text-rose-100"
              >
                {entitlement.message}
              </p>
            ) : (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">
                    <CreditCard className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="font-bold text-slate-950 dark:text-white">
                        {
                          (
                            {
                              free: "Free",
                              lite: "Lite",
                              full: "Full",
                              family: "ファミリーパック",
                            } as const
                          )[entitlement.data.plan]
                        }
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {entitlement.data.status === "safe-default"
                          ? "確認中（Free権限で利用中）"
                          : entitlement.data.status === "free"
                            ? "無料プラン"
                            : "契約中"}
                      </p>
                    </div>
                    <dl className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <div className="flex flex-wrap gap-x-1">
                        <dt>{planDate?.label}</dt>
                        <dd>
                          {planDate?.value
                            ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(
                                new Date(planDate.value),
                              )
                            : "期限なし"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900/60">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">AI返信</dt>
                    <dd className="text-sm font-bold text-slate-950 dark:text-white">
                      残り {entitlement.data.aiReply.remaining} / {entitlement.data.aiReply.limit}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900/60">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">まとめ生成</dt>
                    <dd className="text-sm font-bold text-slate-950 dark:text-white">
                      7日経過＋入力更新時
                    </dd>
                  </div>
                </dl>
                {entitlement.data.plan === "family" && onOpenFamily && (
                  <button
                    type="button"
                    onClick={onOpenFamily}
                    className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-bold text-sky-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-sky-700 dark:bg-sky-400/10 dark:text-sky-100"
                  >
                    ファミリー席を管理
                    <ChevronRight className="size-5" aria-hidden="true" />
                  </button>
                )}
                {onOpenBillingPlans && (
                  <button
                    ref={billingPlansButtonRef}
                    type="button"
                    onClick={onOpenBillingPlans}
                    className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl bg-violet-700 px-4 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                  >
                    {entitlement.data.source === "subscription"
                      ? "料金プランを比較"
                      : "プランをアップグレードする"}
                    <ChevronRight className="size-5" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        <section aria-labelledby="photo-diary-setting-heading" className="mt-6">
          <h2
            id="photo-diary-setting-heading"
            className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
          >
            日記データ
          </h2>
          <button
            ref={photoDiaryButtonRef}
            type="button"
            onClick={onOpenPhotoDiary}
            className="mt-3 flex min-h-16 w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300 hover:bg-sky-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
              <Images className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-slate-950 dark:text-white">写真日記</span>
              <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                LINEで保存した写真の閲覧と削除
              </span>
            </span>
            <ChevronRight className="size-5 text-slate-400" aria-hidden="true" />
          </button>
        </section>

        <section aria-labelledby="avatar-setting-heading" className="mt-6">
          <h2
            id="avatar-setting-heading"
            className="min-h-5 px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
          >
            アバター
          </h2>
          <div className="mt-3">
            {isProfileLoading ? (
              <output
                aria-busy="true"
                aria-label="アバターを読み込んでいます"
                className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <span
                  aria-hidden="true"
                  className="size-16 shrink-0 animate-pulse rounded-full bg-slate-200 motion-reduce:animate-none dark:bg-slate-700"
                />
                <span aria-hidden="true" className="flex-1 space-y-2">
                  <span className="block h-5 w-32 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" />
                  <span className="block h-4 w-24 animate-pulse rounded bg-slate-100 motion-reduce:animate-none dark:bg-slate-700/70" />
                </span>
              </output>
            ) : profileError ? (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100"
              >
                <p className="text-sm font-bold">{profileError}</p>
                {onRetryProfile && (
                  <button
                    type="button"
                    onClick={onRetryProfile}
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-rose-900 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:bg-slate-800 dark:text-rose-100"
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    再試行
                  </button>
                )}
              </div>
            ) : (
              <button
                ref={avatarButtonRef}
                type="button"
                onClick={onOpenAvatar}
                className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300 hover:bg-sky-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-700 dark:hover:bg-sky-950/20"
              >
                <AvatarPreview avatar={avatar} fallbackImageUrl={linePictureUrl} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-slate-950 dark:text-white">
                    {avatar || linePictureUrl ? "アバターを変更" : "アバターを設定"}
                  </span>
                  <span className="mt-1 block truncate text-sm text-slate-500 dark:text-slate-400">
                    {getAvatarName(avatar, linePictureUrl)}
                  </span>
                </span>
                <ChevronRight className="size-5 text-slate-400" aria-hidden="true" />
              </button>
            )}
          </div>
        </section>

        <section aria-labelledby="theme-setting-heading" className="mt-6">
          <h2
            id="theme-setting-heading"
            className="min-h-5 px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
          >
            表示
          </h2>
          <div role="radiogroup" aria-label="表示テーマ" className="mt-3 grid gap-3 sm:grid-cols-2">
            {themes.map((item) => {
              const Icon = item.icon;
              const selected = theme === item.id;
              return (
                <label
                  key={item.id}
                  className={`relative flex min-h-19 cursor-pointer items-center gap-3 rounded-2xl border p-4 text-left transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-500 ${
                    selected
                      ? "border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:border-sky-400 dark:bg-sky-400/10 dark:ring-sky-400"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="color-theme"
                    value={item.id}
                    checked={selected}
                    onChange={() => onThemeChange(item.id)}
                    className="sr-only"
                  />
                  <span
                    className={`${item.iconClassName} flex size-11 shrink-0 items-center justify-center rounded-xl`}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block font-bold text-slate-950 dark:text-white">
                      {item.name}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                      {item.description}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`absolute top-4 right-4 size-4 rounded-full border-2 ${
                      selected
                        ? "border-sky-500 bg-sky-500 ring-2 ring-white dark:border-sky-300 dark:bg-sky-300 dark:ring-slate-800"
                        : "border-slate-300 dark:border-slate-600"
                    }`}
                  />
                </label>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            選んだテーマはこのブラウザに保存され、次に開いたときも使われます。
          </p>

          <div className="mt-4">
            <p
              id="font-size-setting-label"
              className="min-h-5 px-1 text-sm font-bold text-slate-700 dark:text-slate-200"
            >
              文字サイズ
            </p>
            <div
              role="radiogroup"
              aria-labelledby="font-size-setting-label"
              className="mt-2 grid grid-cols-3 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {fontSizes.map((item) => {
                const selected = fontSize === item.id;
                return (
                  <label
                    key={item.id}
                    className={`relative flex min-h-11 cursor-pointer items-center justify-center rounded-xl px-3 font-bold transition focus-within:z-10 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-500 ${
                      selected
                        ? "bg-sky-500 text-white shadow-sm dark:bg-sky-300 dark:text-slate-950"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="font-size"
                      value={item.id}
                      checked={selected}
                      onChange={() => onFontSizeChange(item.id)}
                      className="sr-only"
                    />
                    {item.name}
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        {isAdmin && (
          <section aria-labelledby="admin-setting-heading" className="mt-8">
            <h2
              id="admin-setting-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              管理
            </h2>
            <a
              href="/admin"
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                if (
                  !onOpenAdmin ||
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                onOpenAdmin();
              }}
              className="mt-3 flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-violet-300 hover:bg-violet-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-violet-700 dark:hover:bg-violet-950/20"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200">
                <Shield className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-slate-950 dark:text-white">
                  管理者画面を開く
                </span>
                <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                  利用状況と外部サービスの統計を確認
                </span>
              </span>
              <ChevronRight className="size-5 text-slate-400" aria-hidden="true" />
            </a>
            {onOpenMcp && (
              <a
                ref={mcpLinkRef}
                href="/profile/mcp"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onOpenMcp();
                }}
                className="mt-3 flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300 hover:bg-sky-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-700 dark:hover:bg-sky-950/20"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">
                  <Plug className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-slate-950 dark:text-white">MCP連携</span>
                  <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                    接続、取得履歴、解除を管理
                  </span>
                </span>
                <ChevronRight className="size-5 text-slate-400" aria-hidden="true" />
              </a>
            )}
          </section>
        )}

        {ssoIdentity && onLinkSsoIdentity && onUnlinkSsoIdentity && (
          <section aria-labelledby="sso-identity-heading" className="mt-8">
            <h2
              id="sso-identity-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              ログイン方法
            </h2>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-start gap-3">
                <Shield
                  className="mt-0.5 size-5 text-violet-600 dark:text-violet-300"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">Googleログイン</p>
                  {ssoIdentity.status === "loading" && (
                    <output className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                      接続状態を確認しています...
                    </output>
                  )}
                  {ssoIdentity.status === "error" && (
                    <p role="alert" className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                      {ssoIdentity.message}
                    </p>
                  )}
                  {ssoIdentity.status === "success" && (
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {ssoIdentity.data.linked
                        ? "Googleアカウントを接続済みです。外部ブラウザから同じAccountへログインできます。"
                        : "未接続です。現在のAccountへGoogleログインを追加できます。"}
                    </p>
                  )}
                </div>
              </div>
              {ssoIdentity.status === "success" &&
                (ssoIdentity.data.linked ? (
                  <button
                    type="button"
                    disabled={!ssoIdentity.data.canUnlink || ssoMutationState.status === "loading"}
                    onClick={() => {
                      if (!window.confirm("Googleログインの接続を解除しますか？")) return;
                      setSsoMutationState({ status: "loading" });
                      void onUnlinkSsoIdentity()
                        .then(() =>
                          setSsoMutationState({
                            status: "success",
                            data: "Googleログインを解除しました。",
                          }),
                        )
                        .catch((error) =>
                          setSsoMutationState({
                            status: "error",
                            message: errorMessage(error, "Googleログインを解除できませんでした。"),
                          }),
                        );
                    }}
                    className="mt-4 min-h-11 rounded-xl border border-rose-400 px-4 text-sm font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300"
                  >
                    Google連携を解除
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={ssoMutationState.status === "loading"}
                    onClick={() => {
                      setSsoMutationState({ status: "loading" });
                      void onLinkSsoIdentity().catch((error) =>
                        setSsoMutationState({
                          status: "error",
                          message: errorMessage(error, "Google連携を開始できませんでした。"),
                        }),
                      );
                    }}
                    className="mt-4 min-h-11 rounded-xl border border-violet-500 px-4 text-sm font-bold text-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-200"
                  >
                    Googleと連携
                  </button>
                ))}
              {ssoIdentity.status === "success" &&
                ssoIdentity.data.linked &&
                !ssoIdentity.data.canUnlink && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    最後のログイン方法は解除できません。
                  </p>
                )}
              {ssoIdentityCallbackResult === "linked" && (
                <output className="mt-3 block text-sm text-emerald-700 dark:text-emerald-300">
                  Googleと連携しました。
                </output>
              )}
              {ssoIdentityCallbackResult === "cancelled" && (
                <output className="mt-3 block text-sm text-slate-600 dark:text-slate-300">
                  Google連携をキャンセルしました。
                </output>
              )}
              {ssoIdentityCallbackResult === "error" && (
                <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
                  Googleと連携できませんでした。時間をおいてもう一度お試しください。
                </p>
              )}
              {ssoMutationState.status === "success" && (
                <output className="mt-3 block text-sm text-emerald-700 dark:text-emerald-300">
                  {ssoMutationState.data}
                </output>
              )}
              {ssoMutationState.status === "error" && (
                <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
                  {ssoMutationState.message}
                </p>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="legal-heading" className="mt-8">
          <h2
            id="legal-heading"
            className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
          >
            サービス情報
          </h2>
          <a
            href="/terms"
            className="mt-3 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 font-bold shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800"
          >
            <FileText className="size-5 text-sky-600 dark:text-sky-300" aria-hidden="true" />
            <span className="flex-1">利用規約を確認</span>
            <ChevronRight className="size-5 text-slate-400" aria-hidden="true" />
          </a>
          {serviceTermsAcceptanceHistory}
        </section>

        {onIssueRecoveryCode && (
          <section aria-labelledby="account-recovery-heading" className="mt-8">
            <h2
              id="account-recovery-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              Account復旧
            </h2>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-start gap-3">
                <Shield
                  className="mt-0.5 size-5 text-sky-600 dark:text-sky-300"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-bold">LINE Accountを失ったときに備える</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    一回限りの復旧コードを安全な場所へ保存してください。新しく発行すると以前のコードは使えなくなります。
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={recoveryCodeState.status === "loading"}
                onClick={() => {
                  setRecoveryCodeState({ status: "loading" });
                  void onIssueRecoveryCode()
                    .then((data) => setRecoveryCodeState({ status: "success", data }))
                    .catch((error) =>
                      setRecoveryCodeState({
                        status: "error",
                        message:
                          error instanceof Error
                            ? error.message
                            : "復旧コードを発行できませんでした。",
                      }),
                    );
                }}
                className="mt-4 min-h-11 rounded-xl border border-sky-500 px-4 text-sm font-bold text-sky-700 disabled:opacity-60 dark:text-sky-200"
              >
                {recoveryCodeState.status === "loading" ? "発行しています..." : "復旧コードを発行"}
              </button>
              {recoveryCodeState.status === "success" && (
                <output className="mt-4 block rounded-xl bg-slate-100 p-3 dark:bg-slate-900">
                  <span className="block break-all font-mono text-sm font-bold">
                    {recoveryCodeState.data.code}
                  </span>
                  <span className="mt-2 block text-xs text-slate-500">
                    有効期限: {new Date(recoveryCodeState.data.expiresAt).toLocaleString("ja-JP")}
                  </span>
                </output>
              )}
              {recoveryCodeState.status === "error" && (
                <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
                  {recoveryCodeState.message}
                </p>
              )}
            </div>
          </section>
        )}

        {(onOpenPersonalData ||
          (canOpenBrainItems && onOpenBrainItems) ||
          (canResetAccountData && onResetAccountData)) && (
          <section
            aria-labelledby="development-tools-heading"
            className="mt-8 rounded-2xl border border-dashed border-violet-400/40 bg-violet-400/5 p-4"
          >
            <p className="text-xs font-semibold tracking-wider text-violet-700 dark:text-violet-300">
              DEV ONLY
            </p>
            <h2
              id="development-tools-heading"
              className="mt-1 text-sm font-bold text-slate-950 dark:text-white"
            >
              開発用データ操作
            </h2>
            {onOpenPersonalData && (
              <button
                type="button"
                onClick={onOpenPersonalData}
                className="mt-3 flex min-h-14 w-full items-center gap-3 rounded-xl border border-violet-300/60 bg-white p-3 text-left transition hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-violet-800 dark:bg-slate-800 dark:hover:bg-violet-950/30"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-700 dark:text-violet-300">
                  <FileText className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-950 dark:text-white">
                    入力データを確認する
                  </span>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    日記の訂正・削除とBrain特徴JSONを検証
                  </span>
                </span>
                <ChevronRight className="size-5 text-slate-400" aria-hidden="true" />
              </button>
            )}
            {canOpenBrainItems && onOpenBrainItems && (
              <a
                ref={brainItemsLinkRef}
                href="/profile/brain-items"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onOpenBrainItems();
                }}
                className="mt-3 flex w-full items-center gap-3 rounded-xl border border-violet-300/60 bg-white p-3 text-left transition hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-violet-800 dark:bg-slate-800 dark:hover:bg-violet-950/30"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-700 dark:text-violet-300">
                  <Brain className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-950 dark:text-white">
                    Brain Item一覧を開く
                  </span>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    保存済みItemとVectorの同期状態を確認
                  </span>
                </span>
                <ChevronRight className="size-5 text-slate-400" aria-hidden="true" />
              </a>
            )}
            {canResetAccountData && onResetAccountData && (
              <div className="mt-4 border-t border-rose-300/50 pt-4 dark:border-rose-900">
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  診断、日記、Brain
                  Item、わたしのまとめを物理削除し、すべてのVectorを非同期で削除します。Account、アバター、相性関係は残ります。
                </p>
                <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-rose-800 dark:text-rose-200">
                  <input
                    type="checkbox"
                    checked={resetConfirmed}
                    onChange={(event) => setResetConfirmed(event.currentTarget.checked)}
                    disabled={resetState.status === "loading"}
                    className="mt-0.5 size-4"
                  />
                  <span>削除対象と取り消せないことを確認しました</span>
                </label>
                <button
                  type="button"
                  onClick={() => void resetAccountData()}
                  disabled={resetState.status === "loading" || !resetConfirmed}
                  className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-400/50 px-4 py-2 text-sm font-bold text-rose-700 transition hover:bg-rose-400/10 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:text-rose-200"
                >
                  {resetState.status === "loading" ? (
                    <RefreshCw
                      className="size-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                  {resetState.status === "loading" ? "削除しています..." : "自分のデータを全削除"}
                </button>
                {(resetState.status === "success" || resetState.status === "error") && (
                  <output
                    className={`mt-3 block text-xs ${
                      resetState.status === "success"
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    {resetState.status === "success" ? resetState.data : resetState.message}
                  </output>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </dialog>
  );
}
