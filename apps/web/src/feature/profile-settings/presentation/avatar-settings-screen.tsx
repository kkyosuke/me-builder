import {
  ArrowLeft,
  Check,
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  RotateCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AvatarSelection } from "../model/avatar";
import { getAvatarName } from "../model/avatar";
import { AvatarPreview } from "./components/avatar-preview";
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
  const [uploadedImage, setUploadedImage] = useState<AvatarSelection | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const uploadedObjectUrl = useRef<string | null>(null);

  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (
      selectedCandidateId &&
      !controller.job?.candidates.some((candidate) => candidate.id === selectedCandidateId)
    ) {
      setSelectedCandidateId(null);
    }
  }, [controller.job, selectedCandidateId]);

  useEffect(
    () => () => {
      if (uploadedObjectUrl.current) URL.revokeObjectURL(uploadedObjectUrl.current);
    },
    [],
  );

  const handleFile = async (file: File | undefined) => {
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
    setSelectedCandidateId(null);
    if (uploadedObjectUrl.current) URL.revokeObjectURL(uploadedObjectUrl.current);
    const objectUrl = URL.createObjectURL(file);
    uploadedObjectUrl.current = objectUrl;
    setUploadedImage({ id: "upload", src: objectUrl });
    setUploadedFileName(file.name);
    await controller.upload(file);
  };

  const job = controller.job;
  const isRunning =
    job?.status === "checking" ||
    job?.status === "verified" ||
    job?.status === "accepted" ||
    job?.status === "generating";
  const isChecking = controller.busy || job?.status === "checking";
  const failureTitle =
    job?.errorCode === "generation_rate_limited"
      ? "生成上限に達しました"
      : job?.errorCode === "person_check_failed"
        ? "人物確認を完了できませんでした"
        : "アバター候補を生成できませんでした";

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="avatar-settings-title"
      className="fixed inset-0 z-[70] m-0 h-auto max-h-none w-auto max-w-none overflow-y-auto border-0 bg-slate-50 p-0 dark:bg-slate-900"
    >
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center px-4 sm:px-8">
          <button
            ref={backButtonRef}
            type="button"
            onClick={onBack}
            className="inline-flex size-11 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="プロフィールへ戻る"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <h1
            id="avatar-settings-title"
            className="ml-2 text-lg font-bold text-slate-950 dark:text-white"
          >
            アバター設定
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 pb-16 sm:px-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400">
            現在のアバター
          </p>
          <div className="mt-5 flex justify-center">
            <AvatarPreview avatar={controller.currentAvatar} size="lg" />
          </div>
          <p className="mt-4 font-bold text-slate-950 dark:text-white">
            {controller.loadStatus === "loading"
              ? "読み込み中…"
              : getAvatarName(controller.currentAvatar)}
          </p>
        </section>

        {controller.loadStatus === "error" && (
          <div
            role="alert"
            className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm text-rose-900 dark:bg-rose-400/10 dark:text-rose-200"
          >
            <p className="font-bold">アバター情報を読み込めませんでした</p>
            <p className="mt-1 leading-relaxed">{controller.errorMessage}</p>
            <button
              type="button"
              onClick={() => void controller.refresh()}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 font-bold shadow-sm dark:bg-slate-800"
            >
              <RotateCw className="size-4" aria-hidden="true" />
              再読み込み
            </button>
          </div>
        )}

        <section aria-labelledby="upload-heading" className="mt-8">
          <h2
            id="upload-heading"
            className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
          >
            自分の画像を選ぶ
          </h2>
          <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-4 text-sm text-slate-700 dark:border-violet-800 dark:bg-violet-950/20 dark:text-slate-200">
            <p className="leading-relaxed">
              画像を選ぶと、人物確認と候補生成のため外部AIサービスへ送信されます。画像を使う権利と、写っている人の同意を確認してから選んでください。
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              人物の有無だけを確認し、本人確認や属性推定には利用しません。生成には数分かかることがあり、候補は自動では設定されません。
            </p>
          </div>
          <label
            aria-disabled={controller.busy || isRunning}
            className={`mt-3 flex items-center gap-3 rounded-2xl border border-dashed p-4 transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-500 ${
              !controller.busy && !isRunning
                ? "cursor-pointer border-sky-300 bg-sky-50/70 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/20 dark:hover:bg-sky-950/40"
                : "cursor-not-allowed border-slate-300 bg-slate-100 opacity-60 dark:border-slate-700 dark:bg-slate-800"
            }`}
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-sky-500 text-white">
              {controller.busy ? (
                <LoaderCircle
                  className="size-5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <ImagePlus className="size-5" aria-hidden="true" />
              )}
            </span>
            <span>
              <span className="block font-bold text-slate-950 dark:text-white">
                {uploadedImage || job ? "別の画像を選ぶ" : "画像を選ぶ"}
              </span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                ご自身の顔や上半身が見やすい画像を選んでください
              </span>
            </span>
            <input
              type="file"
              aria-label="アバター用の画像ファイルを選ぶ"
              accept="image/png,image/jpeg,image/webp"
              disabled={controller.busy || isRunning}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
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

        {(controller.busy || isRunning) && (
          <section aria-labelledby="generation-heading" className="mt-8">
            <h2
              id="generation-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              処理中
            </h2>
            <output className="mt-3 flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-900 dark:border-violet-800 dark:bg-violet-400/10 dark:text-violet-200">
              <LoaderCircle
                className="mt-0.5 size-5 shrink-0 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span>
                <span className="block font-bold">アバター候補を作っています</span>
                <span className="mt-1 block text-xs leading-relaxed opacity-80">
                  {isChecking
                    ? "まず人物が写っているか確認しています。"
                    : "人物を確認できました。複数の候補を生成しています。"}
                  この画面を閉じても処理は続きます。
                </span>
              </span>
            </output>
            {uploadedImage && (
              <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                <AvatarPreview avatar={uploadedImage} size="md" />
                <p className="min-w-0 truncate text-sm font-bold text-slate-950 dark:text-white">
                  {uploadedFileName}
                </p>
              </div>
            )}
          </section>
        )}

        {job?.status === "not_person" && (
          <div
            role="alert"
            className="mt-8 flex items-start gap-3 rounded-2xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-400/10 dark:text-rose-200"
          >
            <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">人物を確認できませんでした</p>
              <p className="mt-1 text-sm leading-relaxed opacity-80">
                ご自身の顔や上半身が見やすい画像を選び直してください。
              </p>
            </div>
          </div>
        )}

        {job?.status === "ready" && (
          <section aria-labelledby="candidates-heading" className="mt-8">
            <h2
              id="candidates-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              候補を選ぶ
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {job.candidates.map((candidate, index) => {
                const selected = selectedCandidateId === candidate.id;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    aria-label={`候補${index + 1}を選択`}
                    aria-pressed={selected}
                    onClick={() => setSelectedCandidateId(candidate.id)}
                    className={`relative flex flex-col items-center rounded-2xl border p-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                      selected
                        ? "border-violet-500 bg-violet-50 ring-1 ring-violet-500 dark:bg-violet-400/10"
                        : "border-slate-200 bg-white hover:border-violet-300 dark:border-slate-700 dark:bg-slate-800"
                    }`}
                  >
                    <AvatarPreview avatar={candidate} size="lg" />
                    <span className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                      候補 {index + 1}
                    </span>
                    {selected && (
                      <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-violet-500 text-white">
                        <Check className="size-3" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              候補は期限まで保存され、選んだ画像だけが現在のアバターになります。
            </p>
          </section>
        )}

        {(job?.status === "failed" || job?.status === "cancelled" || job?.status === "expired") && (
          <div
            role="alert"
            className="mt-8 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-400/10 dark:text-amber-100"
          >
            <p className="font-bold">
              {job.status === "failed" ? failureTitle : "この処理は終了しました"}
            </p>
            <p className="mt-1 leading-relaxed">
              {job.errorCode === "generation_rate_limited"
                ? "時間をおいてから、別の画像を選んでもう一度お試しください。"
                : "別の画像を選んでもう一度お試しください。"}
            </p>
          </div>
        )}

        {controller.errorMessage && controller.loadStatus !== "error" && (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900 dark:bg-rose-400/10 dark:text-rose-200"
          >
            {controller.errorMessage}
          </p>
        )}

        <div className="mt-10 space-y-3">
          {job?.status === "ready" && (
            <button
              type="button"
              disabled={!selectedCandidateId || controller.busy}
              onClick={() => {
                if (!selectedCandidateId) return;
                void controller.choose(selectedCandidateId).then((saved) => {
                  if (saved) onSaved();
                });
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-400 px-5 py-4 font-bold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="size-5" aria-hidden="true" />
              このアバターに設定
            </button>
          )}
          {controller.currentAvatar && (
            <button
              type="button"
              disabled={controller.busy}
              onClick={() => void controller.remove()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-400/10"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              現在のアバターを削除
            </button>
          )}
        </div>
      </main>
    </dialog>
  );
}
