import { commercialTransactionsDisclosure } from "@me-builder/shared";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { DocumentMetadata } from "../../../components/document-metadata";
import { config } from "../../../config";
import { serviceSitePageMetadata } from "../model/service-site-page-metadata";

function canonicalUrl(): string | undefined {
  if (!config.baseUrl) return undefined;
  return new URL("/commercial-transactions", config.baseUrl).toString();
}

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

          <header className="mt-6 rounded-[2rem] bg-gradient-to-br from-violet-100 via-white to-sky-100 p-6 shadow-sm sm:p-9 dark:from-violet-950/60 dark:via-slate-900 dark:to-sky-950/40">
            <span className="grid size-12 place-items-center rounded-2xl bg-white text-violet-700 shadow-sm dark:bg-slate-800 dark:text-violet-200">
              <ReceiptText className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-5 text-sm font-bold tracking-widest text-violet-700 dark:text-violet-300">
              COMMERCIAL TRANSACTIONS
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              {commercialTransactionsDisclosure.title}
            </h1>
            <p className="mt-5 leading-8 text-slate-700 dark:text-slate-200">
              {commercialTransactionsDisclosure.summary}
            </p>
          </header>

          <dl className="mt-8 grid gap-4">
            {commercialTransactionsDisclosure.entries.map((entry) => (
              <div
                key={entry.label}
                className="rounded-3xl border border-violet-100 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-900"
              >
                <dt className="font-bold text-slate-950 dark:text-white">{entry.label}</dt>
                <dd className="mt-3 text-sm leading-8 text-slate-700 sm:text-base dark:text-slate-300">
                  {entry.value}
                </dd>
              </div>
            ))}
          </dl>

          <section className="mt-8 rounded-3xl bg-slate-100 p-6 dark:bg-slate-900">
            <h2 className="font-bold">事業者情報の開示請求</h2>
            <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
              購入の判断に先立って確認できるよう、請求を受けた場合は遅滞なく個別に提供します。
            </p>
            <a
              className="mt-3 inline-flex min-h-11 items-center rounded-xl font-bold text-violet-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-300"
              href={`mailto:${commercialTransactionsDisclosure.contact}?subject=${encodeURIComponent("特定商取引法に基づく事業者情報の開示請求")}`}
            >
              {commercialTransactionsDisclosure.contact}
            </a>
          </section>
        </div>
      </main>
    </>
  );
}
