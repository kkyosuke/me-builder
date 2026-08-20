import { ArrowLeft, Check, Download, FilePenLine, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import {
  type PersonalDataCorrection,
  type PersonalDataRecord,
  correctPersonalDataRecord,
  deletePersonalDataRecord,
  fetchPersonalDataFeatures,
  fetchPersonalDataRecords,
} from "../infrastructure/personal-data-api";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "入力データを操作できませんでした。";
}

export function PersonalDataApplication({
  onBack,
  onChanged,
}: {
  onBack: () => void;
  onChanged?: () => void;
}) {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const [records, setRecords] = useState<readonly PersonalDataRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    void reloadKey;
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    void (async () => {
      try {
        setRecords(await fetchPersonalDataRecords(config.apiUrl, controller.signal));
        setStatus("ready");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(message(caught));
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  const save = async (record: PersonalDataRecord) => {
    if (record.kind !== "diary") return;
    const correction: PersonalDataCorrection = { kind: "diary", value: draft };
    setSavingId(record.id);
    setError(null);
    try {
      await correctPersonalDataRecord(config.apiUrl, record.id, correction);
      setEditingId(null);
      onChanged?.();
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (record: PersonalDataRecord) => {
    if (record.kind !== "diary") return;
    if (!window.confirm("この入力を削除し、今後のAI生成や共有で利用しないようにしますか？")) return;
    setSavingId(record.id);
    setError(null);
    try {
      await deletePersonalDataRecord(config.apiUrl, record.id);
      setRecords((current) => current.filter(({ id }) => id !== record.id));
      onChanged?.();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSavingId(null);
    }
  };

  const downloadFeatures = async () => {
    setExporting(true);
    setError(null);
    try {
      const features = await fetchPersonalDataFeatures(config.apiUrl);
      const url = URL.createObjectURL(
        new Blob([`${JSON.stringify(features, null, 2)}\n`], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "me-builder-brain-features.json";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setExporting(false);
    }
  };

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="personal-data-title"
      className="fixed inset-0 z-[70] m-0 h-auto max-h-none w-auto max-w-none overflow-y-auto border-0 bg-slate-50 p-0 dark:bg-slate-900"
    >
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center px-4 sm:px-8">
          <button
            ref={backButtonRef}
            type="button"
            onClick={onBack}
            aria-label="プロフィールへ戻る"
            className="inline-flex size-11 items-center justify-center rounded-full text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <h1
            id="personal-data-title"
            className="ml-2 text-lg font-bold text-slate-950 dark:text-white"
          >
            DEV ONLY: 入力データの確認
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 pb-16 sm:px-8">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed text-sky-950 dark:border-sky-500/30 dark:bg-sky-400/10 dark:text-sky-100">
          開発環境だけの確認画面です。診断回答は確定後に変更・個別削除できません。日記の訂正・削除と、本文や識別子を含まないBrain特徴JSONの書き出しを検証できます。
        </div>

        <button
          type="button"
          disabled={exporting}
          onClick={() => void downloadFeatures()}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-sky-300 bg-white px-4 text-sm font-bold text-sky-700 disabled:opacity-50 dark:border-sky-500/50 dark:bg-slate-800 dark:text-sky-200"
        >
          {exporting ? (
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          Brain特徴JSONを書き出す
        </button>

        {error && (
          <p role="alert" className="mt-4 text-sm font-bold text-rose-700 dark:text-rose-300">
            {error}
          </p>
        )}
        {status === "loading" && (
          <output
            aria-busy="true"
            aria-label="入力データを読み込んでいます"
            className="mt-6 space-y-4"
          >
            {[0, 1].map((index) => (
              <div
                key={index}
                aria-hidden="true"
                className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm motion-reduce:animate-none dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex gap-3">
                  <div className="size-10 rounded-xl bg-slate-200 dark:bg-slate-700" />
                  <div className="flex-1 space-y-3">
                    <div className="h-4 w-2/5 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-1/4 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-4 w-4/5 rounded bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
              </div>
            ))}
          </output>
        )}
        {status === "error" && (
          <button
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
            className="mt-4 min-h-11 rounded-xl bg-sky-600 px-4 font-bold text-white"
          >
            再試行
          </button>
        )}
        {status === "ready" && records.length === 0 && (
          <p className="mt-8 rounded-2xl bg-white p-6 text-center text-sm text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
            確認できる入力データはありません。
          </p>
        )}
        {status === "ready" && records.length > 0 && (
          <ul className="mt-6 space-y-4">
            {records.map((record) => {
              const editing = editingId === record.id;
              const saving = savingId === record.id;
              return (
                <li
                  key={record.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">
                      <FilePenLine className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-950 dark:text-white">
                        {record.title}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {new Intl.DateTimeFormat("ja-JP", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(record.recordedAt))}
                      </p>
                      {!editing && (
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                          {record.value}
                        </p>
                      )}
                    </div>
                  </div>

                  {editing && record.kind === "diary" && (
                    <textarea
                      value={draft}
                      maxLength={5000}
                      onChange={(event) => setDraft(event.currentTarget.value)}
                      rows={5}
                      className="mt-4 w-full rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900"
                    />
                  )}

                  {record.kind === "diary" && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            disabled={saving || draft.trim().length === 0}
                            onClick={() => void save(record)}
                            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white disabled:opacity-50"
                          >
                            {saving ? (
                              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="size-4" aria-hidden="true" />
                            )}
                            保存
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setEditingId(null)}
                            className="min-h-11 rounded-xl px-4 text-sm font-bold text-slate-600 dark:text-slate-300"
                          >
                            キャンセル
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            setEditingId(record.id);
                            setDraft(record.value);
                          }}
                          className="min-h-11 rounded-xl border border-sky-300 px-4 text-sm font-bold text-sky-700 dark:text-sky-200"
                        >
                          訂正
                        </button>
                      )}
                      {!editing && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void remove(record)}
                          className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold text-rose-700 dark:text-rose-200"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          削除
                        </button>
                      )}
                    </div>
                  )}
                  {record.kind === "diagnosis" && (
                    <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      確定済みの診断回答は変更・個別削除できません。
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </dialog>
  );
}
