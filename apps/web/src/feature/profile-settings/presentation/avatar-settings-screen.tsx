import {
  ArrowLeft,
  Check,
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  RotateCw,
  ScanFace,
  Sparkles,
  Trash2,
  UserCheck,
  WandSparkles,
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
  const [hasAiConsent, setHasAiConsent] = useState(false);
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
    job?.status === "checking" || job?.status === "accepted" || job?.status === "generating";

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
            1. 自分の画像を選ぶ
          </h2>
          <label className="mt-3 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <input
              type="checkbox"
              checked={hasAiConsent}
              onChange={(event) => setHasAiConsent(event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-sky-500"
            />
            <span className="leading-relaxed">
              この画像を使う権利と、写っている人の同意を確認しました。人物判定とアバター生成のため、画像が外部AIサービスへ送信されることに同意します。
            </span>
          </label>
          <p className="mt-2 px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            人物の有無だけを確認し、本人確認や年齢・性格などの属性推定には利用しません。PNG、JPEG、WebP形式、10MB以下の画像を利用できます。
          </p>
          <label
            aria-disabled={!hasAiConsent || controller.busy || isRunning}
            className={`mt-3 flex items-center gap-3 rounded-2xl border border-dashed p-4 transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-500 ${
              hasAiConsent && !controller.busy && !isRunning
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
                {uploadedImage || job ? "別の画像を選ぶ" : "画像をアップロード"}
              </span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                ご自身の顔や上半身が見やすい画像を選んでください
              </span>
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!hasAiConsent || controller.busy || isRunning}
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

        {(uploadedImage || job) && job?.status !== "selected" && (
          <section aria-labelledby="person-check-heading" className="mt-8">
            <h2
              id="person-check-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              2. AIで人物を確認する
            </h2>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              {uploadedImage && (
                <div className="flex items-center gap-3">
                  <AvatarPreview avatar={uploadedImage} size="md" />
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-950 dark:text-white">
                      {uploadedFileName}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      人物が写っているかだけを確認します。
                    </p>
                  </div>
                </div>
              )}

              {(controller.busy && !job) || job?.status === "checking" ? (
                <output className="mt-4 flex items-center gap-3 rounded-xl bg-sky-50 p-4 text-sm font-bold text-sky-800 dark:bg-sky-400/10 dark:text-sky-200">
                  <ScanFace
                    className="size-5 animate-pulse motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  人物が写っているか確認しています…
                </output>
              ) : null}

              {job?.status === "not_person" && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-3 rounded-xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-400/10 dark:text-rose-200"
                >
                  <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-bold">人物を確認できませんでした</p>
                    <p className="mt-1 text-xs leading-relaxed opacity-80">
                      ご自身の顔や上半身が見やすい画像を選び直してください。
                    </p>
                  </div>
                </div>
              )}

              {job?.status === "verified" && (
                <output className="mt-4 flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-200">
                  <UserCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="block font-bold">人物を確認できました</span>
                    <span className="mt-1 block text-xs leading-relaxed opacity-80">
                      この画像をもとにAI変換へ進めます。
                    </span>
                  </span>
                </output>
              )}
            </div>
          </section>
        )}

        {job?.status === "verified" && (
          <section aria-labelledby="ai-candidates-heading" className="mt-8">
            <h2
              id="ai-candidates-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              3. AIでアバターに変換する
            </h2>
            <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-800 dark:bg-violet-950/20">
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                外部の画像生成サービスへ送信して複数の候補を作ります。完成後も自動では設定されません。
              </p>
              <button
                type="button"
                disabled={controller.busy}
                onClick={() => void controller.generate()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-4 font-bold text-white shadow-lg shadow-violet-500/20 transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <WandSparkles className="size-5" aria-hidden="true" />
                アバター生成を開始
              </button>
            </div>
          </section>
        )}

        {(job?.status === "accepted" || job?.status === "generating") && (
          <section aria-labelledby="generation-heading" className="mt-8">
            <h2
              id="generation-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              3. AIでアバターに変換する
            </h2>
            <output className="mt-3 flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-900 dark:border-violet-800 dark:bg-violet-400/10 dark:text-violet-200">
              <LoaderCircle
                className="mt-0.5 size-5 shrink-0 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span>
                <span className="block font-bold">アバター候補を生成しています</span>
                <span className="mt-1 block text-xs leading-relaxed opacity-80">
                  画面を開いている間は自動で進捗を確認します。別の画面へ移動しても処理は続きます。
                </span>
              </span>
            </output>
          </section>
        )}

        {job?.status === "ready" && (
          <section aria-labelledby="candidates-heading" className="mt-8">
            <h2
              id="candidates-heading"
              className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
            >
              3. 候補を選ぶ
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
              {job.status === "failed" ? "処理を完了できませんでした" : "この処理は終了しました"}
            </p>
            <p className="mt-1 leading-relaxed">別の画像を選んでもう一度お試しください。</p>
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
          {isRunning && (
            <button
              type="button"
              disabled={controller.busy}
              onClick={() => void controller.cancel()}
              className="w-full rounded-2xl px-5 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              処理を中止
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
