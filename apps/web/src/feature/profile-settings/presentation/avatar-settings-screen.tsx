import { ArrowLeft, Check, ImagePlus, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { useState } from "react";
import { AVATAR_PRESETS, type AvatarSelection, getAvatarName } from "../model/avatar";
import { AvatarPreview } from "./components/avatar-preview";

export function AvatarSettingsScreen({
  currentAvatar,
  onBack,
  onSave,
}: {
  currentAvatar: AvatarSelection | null;
  onBack: () => void;
  onSave: (avatar: AvatarSelection | null) => void;
}) {
  const [selected, setSelected] = useState<AvatarSelection | null>(currentAvatar);
  const [showCandidates, setShowCandidates] = useState(false);

  const handleFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        setSelected({ kind: "uploaded", dataUrl: reader.result, fileName: file.name });
      }
    });
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-50 dark:bg-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center px-4 sm:px-8">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex size-11 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="プロフィールへ戻る"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <h1 className="ml-2 text-lg font-bold text-slate-950 dark:text-white">アバター設定</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 pb-16 sm:px-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400">
            プレビュー
          </p>
          <div className="mt-5 flex justify-center">
            <AvatarPreview avatar={selected} size="lg" />
          </div>
          <p className="mt-4 font-bold text-slate-950 dark:text-white">{getAvatarName(selected)}</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            ダミーUIです。選んだ画像はサーバーへ送信・保存されません。
          </p>
        </section>

        <section aria-labelledby="upload-heading" className="mt-8">
          <h2
            id="upload-heading"
            className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
          >
            画像から選ぶ
          </h2>
          <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-sky-300 bg-sky-50/70 p-4 transition hover:bg-sky-100 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-500 dark:border-sky-700 dark:bg-sky-950/20 dark:hover:bg-sky-950/40">
            <span className="flex size-11 items-center justify-center rounded-xl bg-sky-500 text-white">
              <ImagePlus className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-bold text-slate-950 dark:text-white">
                画像をアップロード
              </span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                この画面だけでプレビューします
              </span>
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
          </label>
        </section>

        <section aria-labelledby="ai-candidates-heading" className="mt-8">
          <h2
            id="ai-candidates-heading"
            className="px-1 text-sm font-bold tracking-wider text-slate-500 dark:text-slate-400"
          >
            AIで候補を作る
          </h2>
          {!showCandidates ? (
            <button
              type="button"
              onClick={() => setShowCandidates(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-4 font-bold text-white shadow-lg shadow-violet-500/20 transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              <WandSparkles className="size-5" aria-hidden="true" />
              ダミー候補を表示
            </button>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {AVATAR_PRESETS.map((candidate) => {
                const avatar: AvatarSelection = {
                  kind: "preset",
                  presetId: candidate.id,
                };
                const isSelected =
                  selected?.kind === "preset" && selected.presetId === candidate.id;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    aria-label={`${candidate.name}を選択`}
                    aria-pressed={isSelected}
                    onClick={() => setSelected(avatar)}
                    className={`relative flex flex-col items-center rounded-2xl border p-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                      isSelected
                        ? "border-violet-500 bg-violet-50 ring-1 ring-violet-500 dark:bg-violet-400/10"
                        : "border-slate-200 bg-white hover:border-violet-300 dark:border-slate-700 dark:bg-slate-800"
                    }`}
                  >
                    <AvatarPreview avatar={avatar} size="md" />
                    <span className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                      {candidate.name}
                    </span>
                    {isSelected && (
                      <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-violet-500 text-white">
                        <Check className="size-3" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-3 flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            本番では生成を非同期で受け付けます。このダミーでは候補をすぐ表示します。
          </p>
        </section>

        <div className="mt-10 space-y-3">
          <button
            type="button"
            disabled={!selected}
            onClick={() => onSave(selected)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-400 px-5 py-4 font-bold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="size-5" aria-hidden="true" />
            このアバターに設定
          </button>
          {currentAvatar && (
            <button
              type="button"
              onClick={() => onSave(null)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:text-red-300 dark:hover:bg-red-400/10"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              現在のアバターを削除
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
