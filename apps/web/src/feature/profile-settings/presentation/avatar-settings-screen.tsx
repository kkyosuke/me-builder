import { ImagePlus, LoaderCircle, Save, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AvatarSelection } from "../model/avatar";
import type { AvatarSettingsController } from "./use-avatar-settings";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function AvatarSettingsScreen({
  controller,
  onBack,
  onSaved,
}: {
  controller: AvatarSettingsController;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedImage, setSelectedImage] = useState<AvatarSelection | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const selectedObjectUrl = useRef<string | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      if (selectedObjectUrl.current) URL.revokeObjectURL(selectedObjectUrl.current);
    },
    [],
  );

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setFileError("PNG、JPEG、WebP形式の画像を選んでください。SVGは利用できません。");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setFileError("画像は10MB以下にしてください。");
      return;
    }

    setFileError(null);
    if (selectedObjectUrl.current) URL.revokeObjectURL(selectedObjectUrl.current);
    const objectUrl = URL.createObjectURL(file);
    selectedObjectUrl.current = objectUrl;
    setSelectedFile(file);
    setSelectedImage({ id: "selected", src: objectUrl });
  };

  const save = async () => {
    if (selectedFile && (await controller.save(selectedFile))) onSaved();
  };

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="avatar-settings-title"
      className="fixed inset-0 z-[70] m-0 flex h-full max-h-none w-full max-w-none items-end justify-center overflow-y-auto border-0 bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !controller.busy) onBack();
      }}
    >
      <section className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-slate-50 px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900 sm:rounded-3xl sm:p-7">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-wider text-sky-600 dark:text-sky-300">
              AVATAR
            </p>
            <h1
              id="avatar-settings-title"
              className="mt-1 text-xl font-bold text-slate-950 dark:text-white"
            >
              アバター画像を選ぶ
            </h1>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            disabled={controller.busy}
            onClick={onBack}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="アバター設定を閉じる"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          画像を選び、表示を確認してから保存してください。
        </p>

        <label className="mt-6 block cursor-pointer rounded-2xl border border-dashed border-sky-300 bg-sky-50/70 p-4 transition hover:bg-sky-100 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-500 dark:border-sky-700 dark:bg-sky-950/20 dark:hover:bg-sky-950/40">
          {selectedImage ? (
            <span className="flex flex-col items-center">
              <img
                src={selectedImage.src}
                alt="保存するアバター画像のプレビュー"
                className="aspect-square w-full max-w-64 rounded-full object-cover shadow-md"
              />
              <span className="mt-3 text-sm font-bold text-sky-700 dark:text-sky-300">
                別の画像を選ぶ
              </span>
              <span className="mt-1 max-w-full truncate text-xs text-slate-500 dark:text-slate-400">
                {selectedFile?.name}
              </span>
            </span>
          ) : (
            <span className="flex min-h-36 flex-col items-center justify-center text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-sky-500 text-white">
                <ImagePlus className="size-6" aria-hidden="true" />
              </span>
              <span className="mt-3 font-bold text-slate-950 dark:text-white">画像を選ぶ</span>
              <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                PNG・JPEG・WebP、10MBまで
              </span>
            </span>
          )}
          <input
            type="file"
            aria-label="アバター用の画像ファイルを選ぶ"
            accept="image/png,image/jpeg,image/webp"
            disabled={controller.busy}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              handleFile(file);
            }}
          />
        </label>

        {(fileError || controller.errorMessage) && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900 dark:bg-rose-400/10 dark:text-rose-200"
          >
            {fileError ?? controller.errorMessage}
          </p>
        )}

        <p className="mt-5 rounded-2xl bg-sky-50/70 p-4 text-xs leading-relaxed text-slate-600 dark:bg-sky-950/20 dark:text-slate-300">
          画像を使う権利と、写っている人の同意を確認してください。画像は外部のAIサービスへ送信しません。
        </p>
        <button
          type="button"
          disabled={!selectedFile || controller.busy}
          onClick={() => void save()}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-400 px-5 py-4 font-bold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {controller.busy ? (
            <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Save className="size-5" aria-hidden="true" />
          )}
          保存
        </button>

        {controller.currentAvatar && !controller.busy && (
          <button
            type="button"
            onClick={() => void controller.remove()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:text-red-300 dark:hover:bg-red-400/10"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            現在のアバターを削除
          </button>
        )}
      </section>
    </dialog>
  );
}
