import { BellRing, ChevronDown } from "lucide-react";
import type { ServiceTermsStatus } from "../model/service-terms";

type Notice = NonNullable<ServiceTermsStatus["notice"]>;

function displayDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, ".");
}

/** 主機能を止めず、適用前の重要改定または適用後30日以内の軽微改定を表示する。 */
export function ServiceTermsNotice({ notice }: { notice: Notice }) {
  const upcoming = notice.type === "important-upcoming";
  return (
    <aside
      aria-label="利用規約の改定案内"
      className="border-b border-sky-200 bg-sky-50 px-4 py-3 text-slate-900 dark:border-sky-800 dark:bg-sky-950 dark:text-white"
    >
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start gap-3">
          <BellRing className="mt-0.5 size-5 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {upcoming ? "利用規約の重要な改定を予定しています" : "利用規約を更新しました"}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
              {notice.document.summary}
            </p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              version {notice.document.version}・適用日 {displayDate(notice.effectiveAt)}
              {upcoming ? "（適用日までは現在の規約で利用できます）" : ""}
            </p>
          </div>
        </div>
        <details className="group mt-2 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-bold text-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-sky-200">
            改定後の全文を確認する
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </summary>
          <article className="mt-2 space-y-4 rounded-2xl bg-white p-4 dark:bg-slate-900">
            {notice.document.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="font-bold">{section.heading}</h2>
                <div className="mt-2 space-y-2 leading-6 text-slate-700 dark:text-slate-300">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </article>
        </details>
      </div>
    </aside>
  );
}
