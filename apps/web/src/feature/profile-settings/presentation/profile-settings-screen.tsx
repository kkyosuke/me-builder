import { ArrowLeft, ChevronRight, Moon, RefreshCw, Shield, Sparkles, Sun } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ColorTheme } from "../../theme/model/color-theme";
import type { FontSize } from "../../theme/model/font-size";
import { type AvatarSelection, getAvatarName } from "../model/avatar";
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
  isProfileLoading = false,
  profileError = null,
  linePictureUrl,
  theme,
  fontSize,
  onBack,
  onOpenAvatar,
  onRetryProfile,
  onThemeChange,
  onFontSizeChange,
}: {
  avatar: AvatarSelection | null;
  isAdmin?: boolean;
  isInactive?: boolean;
  isProfileLoading?: boolean;
  profileError?: string | null;
  linePictureUrl?: string | undefined;
  theme: ColorTheme;
  fontSize: FontSize;
  onBack: () => void;
  onOpenAvatar: () => void;
  onRetryProfile?: () => void;
  onThemeChange: (theme: ColorTheme) => void;
  onFontSizeChange: (fontSize: FontSize) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const wasInactiveRef = useRef(isInactive);

  useEffect(() => {
    dialogRef.current?.toggleAttribute("inert", isInactive);
    if (isInactive) {
      wasInactiveRef.current = true;
      return;
    }

    if (wasInactiveRef.current) {
      avatarButtonRef.current?.focus();
    } else {
      backButtonRef.current?.focus();
    }
    wasInactiveRef.current = false;
  }, [isInactive]);

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

      <main className="mx-auto w-full max-w-2xl px-4 py-8 pb-16 sm:px-8">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-white to-violet-100 p-6 shadow-lg shadow-slate-950/5 dark:from-sky-950/60 dark:via-slate-800 dark:to-violet-950/50">
          <div className="flex items-center gap-4">
            <AvatarPreview avatar={avatar} fallbackImageUrl={linePictureUrl} size="lg" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-violet-700 dark:text-violet-200">
                <Sparkles className="size-4" aria-hidden="true" />
                YOUR PROFILE
              </p>
              <h2 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">
                あなたらしい見た目に
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                アバターと画面の見やすさをここで整えられます。
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="avatar-setting-heading" className="mt-8">
          <h2
            id="avatar-setting-heading"
            className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
          >
            アバター
          </h2>
          {isProfileLoading ? (
            <output
              aria-busy="true"
              aria-label="アバターを読み込んでいます"
              className="mt-3 flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
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
              className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100"
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
              className="mt-3 flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300 hover:bg-sky-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-700 dark:hover:bg-sky-950/20"
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
        </section>

        <section aria-labelledby="theme-setting-heading" className="mt-8">
          <h2
            id="theme-setting-heading"
            className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
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
                  className={`relative flex cursor-pointer items-center gap-3 rounded-2xl border p-4 text-left transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-500 ${
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
          <p className="mt-3 px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            選んだテーマはこのブラウザに保存され、次に開いたときも使われます。
          </p>

          <div className="mt-6">
            <p
              id="font-size-setting-label"
              className="px-1 text-sm font-bold text-slate-700 dark:text-slate-200"
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
          </section>
        )}
      </main>
    </dialog>
  );
}
