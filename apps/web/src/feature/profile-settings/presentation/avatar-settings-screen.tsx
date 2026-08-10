import { Check, CircleAlert, ImagePlus, LoaderCircle, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AvatarSelection } from "../model/avatar";
import { AvatarPreview } from "./components/avatar-preview";
import type { AvatarSettingsController } from "./use-avatar-settings";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function failureMessage(controller: AvatarSettingsController): {
  title: string;
  description: string;
} | null {
  const job = controller.job;
  if (!job) return null;
  if (job.status === "not_person") {
    return {
      title: "人物を確認できませんでした",
      description: "ご自身の顔や上半身が見やすい画像を選び直してください。",
    };
  }
  if (job.status !== "failed" && job.status !== "cancelled" && job.status !== "expired") {
    return null;
  }
  return job.errorCode === "generation_rate_limited"
    ? {
        title: "生成上限に達しました",
        description: "時間をおいてから、別の画像でもう一度お試しください。",
      }
    : {
        title: "アバター候補を生成できませんでした",
        description: "別の画像を選んでもう一度お試しください。",
      };
}

export function AvatarSettingsScreen({
  controller,
  onBack,
  onSaved,
}: {
  controller: AvatarSettingsController;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedImage, setUploadedImage] = useState<AvatarSelection | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // 初期取得前のjob=nullで表示モードを固定しない。利用者が明示的に作り直す場合だけ候補を隠す。
  const [forceUpload, setForceUpload] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const uploadedObjectUrl = useRef<string | null>(null);

  const candidatesReady = controller.job?.status === "ready" && !forceUpload;
  const jobFailure = failureMessage(controller);

  useEffect(() => {
    closeButtonRef.current?.focus();
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
    if (uploadedObjectUrl.current) URL.revokeObjectURL(uploadedObjectUrl.current);
    const objectUrl = URL.createObjectURL(file);
    uploadedObjectUrl.current = objectUrl;
    setUploadedFile(file);
    setUploadedImage({ id: "upload", src: objectUrl });
  };

  const upload = async () => {
    if (!uploadedFile) return;
    if (await controller.upload(uploadedFile)) onSaved();
  };

  const choose = async () => {
    if (!selectedCandidateId) return;
    if (await controller.choose(selectedCandidateId)) onSaved();
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
            <p className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-violet-600 dark:text-violet-300">
              <Sparkles className="size-4" aria-hidden="true" />
              AVATAR
            </p>
            <h1
              id="avatar-settings-title"
              className="mt-1 text-xl font-bold text-slate-950 dark:text-white"
            >
              {candidatesReady ? "候補から選ぶ" : "アバター画像を選ぶ"}
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

        {candidatesReady ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              好きな候補を1つ選んでください。選ぶだけでは現在のアバターは変わりません。
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {controller.job?.candidates.map((candidate, index) => {
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
                      <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-violet-500 text-white">
                        <Check className="size-4" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={!selectedCandidateId || controller.busy}
              onClick={() => void choose()}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-400 px-5 py-4 font-bold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {controller.busy ? (
                <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Check className="size-5" aria-hidden="true" />
              )}
              このアバターに設定
            </button>
            <button
              type="button"
              disabled={controller.busy}
              onClick={() => {
                setSelectedCandidateId(null);
                setForceUpload(true);
              }}
              className="mt-3 w-full rounded-xl px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              別の画像から作り直す
            </button>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              ご自身の顔や上半身が見やすい画像を選んでください。選んだ画像を確認してから送信できます。
            </p>

            {jobFailure && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-3 rounded-2xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-400/10 dark:text-rose-200"
              >
                <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">{jobFailure.title}</p>
                  <p className="mt-1 text-sm leading-relaxed opacity-80">
                    {jobFailure.description}
                  </p>
                </div>
              </div>
            )}

            <label className="mt-6 block cursor-pointer rounded-2xl border border-dashed border-sky-300 bg-sky-50/70 p-4 transition hover:bg-sky-100 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-500 dark:border-sky-700 dark:bg-sky-950/20 dark:hover:bg-sky-950/40">
              {uploadedImage ? (
                <span className="flex flex-col items-center">
                  <img
                    src={uploadedImage.src}
                    alt="送信する画像のプレビュー"
                    className="aspect-square w-full max-w-64 rounded-2xl object-cover shadow-md"
                  />
                  <span className="mt-3 text-sm font-bold text-sky-700 dark:text-sky-300">
                    別の画像を選ぶ
                  </span>
                  <span className="mt-1 max-w-full truncate text-xs text-slate-500 dark:text-slate-400">
                    {uploadedFile?.name}
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

            {fileError && (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900 dark:bg-rose-400/10 dark:text-rose-200"
              >
                {fileError}
              </p>
            )}
            {controller.errorMessage && (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900 dark:bg-rose-400/10 dark:text-rose-200"
              >
                {controller.errorMessage}
              </p>
            )}

            <p className="mt-5 rounded-2xl bg-violet-50/70 p-4 text-xs leading-relaxed text-slate-600 dark:bg-violet-950/20 dark:text-slate-300">
              送信すると人物確認と候補生成のため外部AIサービスを利用します。画像を使う権利と、写っている人の同意を確認してください。候補は自動では設定されません。
            </p>
            <button
              type="button"
              disabled={!uploadedFile || controller.busy}
              onClick={() => void upload()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-400 px-5 py-4 font-bold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {controller.busy && (
                <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
              )}
              この画像で候補を作る
            </button>
          </>
        )}

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
