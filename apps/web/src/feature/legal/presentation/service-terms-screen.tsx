import { ArrowLeft, CheckCircle2, FileText, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ServiceTermsStatus } from "../model/service-terms";

export function ServiceTermsScreen({
  status,
  submitting = false,
  error = null,
  onAccept,
  onBack,
}: {
  status: ServiceTermsStatus;
  submitting?: boolean;
  error?: string | null;
  onAccept?: () => void;
  onBack?: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const { document, acceptance } = status;
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950 dark:bg-slate-900 dark:text-white">
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center px-4 sm:px-8">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mr-2 inline-flex size-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="利用規約を閉じる"
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
            </button>
          )}
          <FileText className="mr-3 size-5 text-sky-600 dark:text-sky-300" aria-hidden="true" />
          <h1 className="text-lg font-bold">{document.title}</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 pb-40 sm:px-8">
        <div className="rounded-3xl bg-gradient-to-br from-sky-100 via-white to-violet-100 p-6 shadow-sm dark:from-sky-950/60 dark:via-slate-800 dark:to-violet-950/50">
          <p className="text-sm leading-7 text-slate-700 dark:text-slate-200">{document.summary}</p>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            version {document.version}・適用日 {document.publishedAt.slice(0, 10)}
          </p>
        </div>

        <article className="mt-6 space-y-5">
          {document.sections.map((section) => (
            <section
              key={section.heading}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <h2 className="font-bold">{section.heading}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </article>

        {!acceptance.required && acceptance.acceptedAt && (
          <p className="mt-6 flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200">
            <CheckCircle2 className="size-5" aria-hidden="true" />
            {new Date(acceptance.acceptedAt).toLocaleString("ja-JP")} に同意済み
          </p>
        )}
      </main>

      {acceptance.required && onAccept && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="mx-auto max-w-2xl">
            <label className="flex cursor-pointer items-start gap-3 text-sm font-bold">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 size-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              利用規約の内容を確認し、同意します
            </label>
            {error && (
              <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={onAccept}
              disabled={!confirmed || submitting}
              className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 px-5 font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:bg-sky-300 dark:text-slate-950"
            >
              {submitting && (
                <RefreshCw
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {submitting ? "同意を記録しています..." : "同意して利用を始める"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
