import { Check, ImagePlus, Info, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type AvatarSelection, getAvatarName } from "../model/avatar";
import { normalizeAvatarImage } from "../model/normalize-avatar-image";
import { AvatarPreview } from "./components/avatar-preview";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function AvatarSettingsScreen({
  currentAvatar,
  linePictureUrl,
  onBack,
  onSave,
}: {
  currentAvatar: AvatarSelection | null;
  linePictureUrl?: string | undefined;
  onBack: () => void;
  onSave: (avatar: AvatarSelection | null) => void;
}) {
  const [selectedImage, setSelectedImage] = useState<AvatarSelection | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const selectionIdRef = useRef(0);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const selectionId = selectionIdRef.current + 1;
    selectionIdRef.current = selectionId;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setFileError("PNG、JPEG、WebP形式の画像を選んでください。SVGは利用できません。");
      setSelectedImage(null);
      setIsPreparingImage(false);
      return;
    }

    setFileError(null);
    setSelectedImage(null);
    setIsPreparingImage(true);
    try {
      const normalizedImage = await normalizeAvatarImage(file);
      if (selectionIdRef.current === selectionId) setSelectedImage(normalizedImage);
    } catch {
      if (selectionIdRef.current === selectionId) {
        setFileError("画像を読み込めませんでした。別の画像を選んでください。");
      }
    } finally {
      if (selectionIdRef.current === selectionId) setIsPreparingImage(false);
    }
  };

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="avatar-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        onBack();
      }}
      className="fixed inset-0 z-[70] m-0 flex h-dvh max-h-none w-full max-w-none items-end justify-center overflow-hidden border-0 bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl dark:bg-slate-900 sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl">
        <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-4 dark:border-slate-700 dark:bg-slate-900 sm:px-6">
          <div>
            <p className="text-xs font-bold tracking-wider text-sky-600 dark:text-sky-300">
              PROFILE IMAGE
            </p>
            <h1
              id="avatar-settings-title"
              className="mt-0.5 text-lg font-bold text-slate-950 dark:text-white"
            >
              アバターを変更
            </h1>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onBack}
            className="inline-flex size-11 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="アバター変更を閉じる"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <main className="overflow-y-auto px-4 py-6 sm:px-6">
          <section className="rounded-3xl bg-gradient-to-br from-sky-100 via-white to-violet-100 p-5 dark:from-sky-950/60 dark:via-slate-800 dark:to-violet-950/50">
            <div className="flex items-center gap-4">
              <AvatarPreview avatar={currentAvatar} fallbackImageUrl={linePictureUrl} size="lg" />
              <div className="min-w-0">
                <p className="text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400">
                  現在のアバター
                </p>
                <p className="mt-2 break-words font-bold text-slate-950 dark:text-white">
                  {getAvatarName(currentAvatar, linePictureUrl)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {currentAvatar
                    ? "アプリで選んだ画像を表示しています。"
                    : linePictureUrl
                      ? "LINEのプロフィール画像を表示しています。"
                      : "画像を選ぶとプロフィールに表示できます。"}
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="image-selection-heading" className="mt-6">
            <h2
              id="image-selection-heading"
              className="px-1 text-sm font-bold text-slate-950 dark:text-white"
            >
              端末から画像を選ぶ
            </h2>
            <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-sky-300 bg-sky-50/70 p-4 transition hover:bg-sky-100 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-500 dark:border-sky-700 dark:bg-sky-950/20 dark:hover:bg-sky-950/40">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white">
                <ImagePlus className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span aria-live="polite" className="block font-bold text-slate-950 dark:text-white">
                  {isPreparingImage
                    ? "画像を準備しています"
                    : selectedImage
                      ? "別の画像を選ぶ"
                      : "画像を選ぶ"}
                </span>
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  PNG、JPEG、WebPに対応
                </span>
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label={selectedImage ? "別の画像を選ぶ" : "画像を選ぶ"}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void handleFile(file);
                }}
              />
            </label>
            {fileError && (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900 dark:bg-rose-400/10 dark:text-rose-200"
              >
                {fileError}
              </p>
            )}
          </section>

          {selectedImage && (
            <section aria-labelledby="avatar-preview-heading" className="mt-6">
              <h2
                id="avatar-preview-heading"
                className="px-1 text-sm font-bold text-slate-950 dark:text-white"
              >
                設定後のプレビュー
              </h2>
              <div className="mt-3 rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="flex justify-center">
                  <AvatarPreview avatar={selectedImage} size="xl" />
                </div>
                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                  画像は中央を正方形に切り抜き、プロフィールでは円形で表示されます。
                </p>
              </div>
            </section>
          )}

          <div className="mt-6 flex items-start gap-3 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Info
              className="mt-0.5 size-5 shrink-0 text-sky-600 dark:text-sky-300"
              aria-hidden="true"
            />
            <p className="leading-relaxed">
              現在はUI確認用のため、選んだ画像はサーバーへ送信・保存されず、再読み込みすると
              {linePictureUrl ? "元のLINE画像" : "画像未設定の状態"}に戻ります。
            </p>
          </div>
        </main>

        <footer className="shrink-0 space-y-2 border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:px-6">
          <button
            type="button"
            disabled={!selectedImage || isPreparingImage}
            onClick={() => onSave(selectedImage)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-400 px-5 py-4 font-bold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="size-5" aria-hidden="true" />
            この画像を設定
          </button>
          {currentAvatar && (
            <button
              type="button"
              onClick={() => onSave(null)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {linePictureUrl ? (
                <RotateCcw className="size-4" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              {linePictureUrl ? "LINEの画像に戻す" : "現在の画像を削除"}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  );
}
