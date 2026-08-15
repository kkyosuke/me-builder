import { currentServiceTerms } from "@me-builder/shared";
import { ArrowLeft, FileText, Scale } from "lucide-react";
import { DocumentMetadata } from "../../../components/document-metadata";
import { config } from "../../../config";
import { serviceSitePageMetadata } from "../model/service-site-page-metadata";
import { LineFriendAddButton } from "./components/line-friend-add-button";

function canonicalUrl(): string | undefined {
  if (!config.baseUrl) return undefined;
  return new URL("/terms", config.baseUrl).toString();
}

function displayDate(publishedAt: string): string {
  return publishedAt.slice(0, 10).replace(/-/g, ".");
}

export function ServiceSiteTermsScreen() {
  const pageCanonicalUrl = canonicalUrl();
  const metadata = serviceSitePageMetadata.terms;

  return (
    <>
      <DocumentMetadata
        title={metadata.title}
        description={metadata.description}
        robots={metadata.robots}
        {...(pageCanonicalUrl ? { canonicalUrl: pageCanonicalUrl } : {})}
      />
      <main id="main-content" className="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <a
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-bold text-violet-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-300"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            サービス紹介へ戻る
          </a>

          <header className="mt-6 rounded-[2rem] bg-gradient-to-br from-violet-100 via-white to-sky-100 p-6 shadow-sm sm:p-9 dark:from-violet-950/60 dark:via-slate-900 dark:to-sky-950/40">
            <span className="grid size-12 place-items-center rounded-2xl bg-white text-violet-700 shadow-sm dark:bg-slate-800 dark:text-violet-200">
              <Scale className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-5 text-sm font-bold tracking-widest text-violet-700 dark:text-violet-300">
              TERMS OF SERVICE
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              {currentServiceTerms.title}
            </h1>
            <p className="mt-5 leading-8 text-slate-700 dark:text-slate-200">
              {currentServiceTerms.summary}
            </p>
            <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-600 dark:text-slate-300">
              <div className="flex gap-2">
                <dt className="font-bold">version</dt>
                <dd>{currentServiceTerms.version}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-bold">適用日</dt>
                <dd>{displayDate(currentServiceTerms.publishedAt)}</dd>
              </div>
            </dl>
          </header>

          <article className="mt-8 grid gap-5">
            {currentServiceTerms.sections.map((section) => (
              <section
                key={section.heading}
                className="rounded-3xl border border-violet-100 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-900"
              >
                <h2 className="flex items-start gap-3 text-lg font-bold sm:text-xl">
                  <FileText
                    className="mt-0.5 size-5 shrink-0 text-violet-600 dark:text-violet-300"
                    aria-hidden="true"
                  />
                  {section.heading}
                </h2>
                <div className="mt-4 grid gap-4 text-sm leading-8 text-slate-700 sm:text-base dark:text-slate-300">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </article>

          <div className="mt-10 flex flex-col gap-3 rounded-3xl bg-slate-100 p-6 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-900">
            <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
              利用開始時や重要な改定時の同意は、本人向けWebアプリ内で確認します。
            </p>
            <LineFriendAddButton className="shrink-0" />
          </div>
        </div>
      </main>
    </>
  );
}
