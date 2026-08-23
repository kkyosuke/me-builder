import { ArrowLeft, Image as ImageIcon, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import {
  type PhotoDiaryItem,
  deletePhotoDiary,
  fetchPhotoDiaries,
  resolvePhotoDiaryImageUrl,
} from "../infrastructure/photo-diary-api";

export function PhotoDiaryScreen({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<AsyncState<readonly PhotoDiaryItem[]>>({ status: "loading" });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const load = useCallback(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchPhotoDiaries(config.apiUrl, controller.signal)
      .then((items) => setState({ status: "success", data: items }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "写真日記を取得できませんでした。",
          });
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => backButtonRef.current?.focus(), []);

  const remove = async (item: PhotoDiaryItem) => {
    if (!window.confirm("この写真日記を削除しますか？削除後は元に戻せません。")) return;
    setActionError(null);
    setDeletingId(item.id);
    try {
      await deletePhotoDiary(config.apiUrl, item.id);
      setState((current) =>
        current.status === "success"
          ? { status: "success", data: current.data.filter(({ id }) => id !== item.id) }
          : current,
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "写真日記を削除できませんでした。");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="photo-diary-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!deletingId) onBack();
      }}
      className="fixed inset-0 z-[70] m-0 h-auto max-h-none w-auto max-w-none overflow-y-auto border-0 bg-slate-50 p-0 dark:bg-slate-900"
    >
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center px-4">
          <button
            ref={backButtonRef}
            type="button"
            onClick={onBack}
            aria-label="プロフィールへ戻る"
            className="flex size-11 items-center justify-center rounded-full"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <h1 id="photo-diary-title" className="ml-2 text-lg font-bold">
            写真日記
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 pb-16">
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          LINEで送った写真を保存しています。現在、写真のAI分析は行っていません。
        </p>
        {actionError && (
          <p role="alert" className="mt-4 text-sm text-rose-700 dark:text-rose-300">
            {actionError}
          </p>
        )}
        {(state.status === "loading" || state.status === "idle") && (
          <output aria-busy="true" className="mt-6 block text-sm text-slate-500">
            写真を読み込んでいます...
          </output>
        )}
        {state.status === "error" && (
          <div role="alert" className="mt-6 rounded-2xl bg-rose-50 p-4 dark:bg-rose-400/10">
            <p>{state.message}</p>
            <button
              type="button"
              onClick={load}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 font-bold dark:bg-slate-800"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              再試行
            </button>
          </div>
        )}
        {state.status === "success" && state.data.length === 0 && (
          <div className="mt-8 rounded-3xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
            <ImageIcon className="mx-auto size-8 text-slate-400" aria-hidden="true" />
            <p className="mt-3 font-bold">保存した写真はまだありません</p>
            <p className="mt-1 text-sm text-slate-500">
              写真入力の公開後、LINEで写真を1枚送るとここに表示されます。
            </p>
          </div>
        )}
        {state.status === "success" && state.data.length > 0 && (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {state.data.map((item) => {
              const date = new Intl.DateTimeFormat("ja-JP", {
                dateStyle: "long",
                timeStyle: "short",
              }).format(new Date(item.capturedAt));
              return (
                <li
                  key={item.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <a
                    href={resolvePhotoDiaryImageUrl(config.apiUrl, item.originalUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={resolvePhotoDiaryImageUrl(config.apiUrl, item.thumbnailUrl)}
                      alt={`${date}の日記に添付された写真`}
                      className="aspect-square w-full object-cover"
                    />
                  </a>
                  <div className="p-4">
                    <time dateTime={item.capturedAt} className="text-sm font-bold">
                      {date}
                    </time>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.width} × {item.height} / {(item.byteSize / 1024 / 1024).toFixed(1)}MB
                    </p>
                    <button
                      type="button"
                      onClick={() => void remove(item)}
                      disabled={deletingId === item.id}
                      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-rose-700 disabled:opacity-50 dark:text-rose-300"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {deletingId === item.id ? "削除しています..." : "削除"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </dialog>
  );
}
