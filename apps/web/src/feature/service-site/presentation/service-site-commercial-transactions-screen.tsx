import { ArrowLeft, CircleDollarSign } from "lucide-react";
import { DocumentMetadata } from "../../../components/document-metadata";
import { config } from "../../../config";
import { serviceSitePageMetadata } from "../model/service-site-page-metadata";

function canonicalUrl(): string | undefined {
  if (!config.baseUrl) return undefined;
  return new URL("/commercial-transactions", config.baseUrl).toString();
}

/** Free限定公開中の旧直リンクへ、有料条件を出さず現在の提供境界だけを示す。 */
export function ServiceSiteCommercialTransactionsScreen() {
  const pageCanonicalUrl = canonicalUrl();
  const metadata = serviceSitePageMetadata["commercial-transactions"];

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

          <section className="mt-6 rounded-[2rem] bg-gradient-to-br from-violet-100 via-white to-sky-100 p-6 shadow-sm sm:p-9 dark:from-violet-950/60 dark:via-slate-900 dark:to-sky-950/40">
            <span className="grid size-12 place-items-center rounded-2xl bg-white text-violet-700 shadow-sm dark:bg-slate-800 dark:text-violet-200">
              <CircleDollarSign className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-5 text-sm font-bold tracking-widest text-violet-700 dark:text-violet-300">
              CURRENT AVAILABILITY
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              現在は無料で利用できます
            </h1>
            <p className="mt-5 leading-8 text-slate-700 dark:text-slate-200">
              現在、有料Planの一般提供は行っていません。公開中の機能は、どなたでも無料で利用できます。
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
