import { currentPrivacyPolicy } from "@me-builder/shared";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { DocumentMetadata } from "../../../components/document-metadata";
import { config } from "../../../config";
import { serviceSitePageMetadata } from "../model/service-site-page-metadata";

function canonicalUrl(): string | undefined {
  if (!config.baseUrl) return undefined;
  return new URL("/privacy", config.baseUrl).toString();
}

export function ServiceSitePrivacyScreen() {
  const pageCanonicalUrl = canonicalUrl();
  const metadata = serviceSitePageMetadata.privacy;

  return (
    <>
      <DocumentMetadata
        title={metadata.title}
        description={metadata.description}
        robots={metadata.robots}
        {...(pageCanonicalUrl ? { canonicalUrl: pageCanonicalUrl } : {})}
      />
      <main id="main-content" className="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <a
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-bold text-violet-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-300"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            サービス紹介へ戻る
          </a>

          <header className="mt-6 rounded-[2rem] bg-gradient-to-br from-emerald-100 via-white to-sky-100 p-6 shadow-sm sm:p-9 dark:from-emerald-950/50 dark:via-slate-900 dark:to-sky-950/40">
            <span className="grid size-12 place-items-center rounded-2xl bg-white text-emerald-700 shadow-sm dark:bg-slate-800 dark:text-emerald-200">
              <ShieldCheck className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-5 text-sm font-bold tracking-widest text-emerald-800 dark:text-emerald-300">
              PRIVACY POLICY
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              {currentPrivacyPolicy.title}
            </h1>
            <p className="mt-5 max-w-2xl leading-8 text-slate-700 dark:text-slate-200">
              かがみで扱う情報、利用目的、外部サービスへの送信、安全管理について説明します。
            </p>
            <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-600 dark:text-slate-300">
              <div className="flex gap-2">
                <dt className="font-bold">version</dt>
                <dd>{currentPrivacyPolicy.version}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-bold">制定・適用日</dt>
                <dd>{currentPrivacyPolicy.effectiveAt.slice(0, 10).replace(/-/g, ".")}</dd>
              </div>
            </dl>
          </header>

          <article className="mt-8 grid gap-5">
            {currentPrivacyPolicy.sections.map((section) => (
              <section
                key={section.heading}
                className="rounded-3xl border border-violet-100 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-900"
              >
                <h2 className="flex items-start gap-3 text-lg font-bold sm:text-xl">
                  <FileText
                    className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300"
                    aria-hidden="true"
                  />
                  {section.heading}
                </h2>
                <div className="mt-4 grid gap-4 text-sm leading-8 text-slate-700 sm:text-base dark:text-slate-300">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.items && (
                    <ul className="list-disc space-y-2 pl-6">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>
    </>
  );
}
