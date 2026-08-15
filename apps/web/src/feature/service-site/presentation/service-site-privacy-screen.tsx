import { ArrowLeft, CircleAlert, ClipboardList, ExternalLink, ShieldCheck } from "lucide-react";
import { DocumentMetadata } from "../../../components/document-metadata";
import { config } from "../../../config";
import { serviceSitePageMetadata } from "../model/service-site-page-metadata";

const publicationRequirements = [
  ["運営者と窓口", "運営者の正式名称と、問い合わせを受け付ける有効な連絡先"],
  ["取得する情報", "取得する情報の種類、それぞれの取得方法"],
  ["利用目的", "情報を何のために利用し、どの機能へ使うか"],
  ["外部送信", "LINE、AIサービス、インフラなどの送信先と送信目的"],
  ["提供と共有", "他の利用者や第三者へ情報を提供する条件"],
  ["保存と削除", "保存期間または期間の決定方法、削除の手続き"],
  ["利用者の権利", "開示、訂正、削除、利用停止などを請求する方法"],
  ["端末上の保存", "Cookie、localStorage、アクセス解析の利用状況"],
  ["未成年者", "未成年者が利用する場合の同意と情報の扱い"],
  ["制定と改定", "公開日、適用日、改定時の通知方法"],
] as const;

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
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <p className="text-sm font-bold tracking-widest text-emerald-800 dark:text-emerald-300">
                PRIVACY POLICY
              </p>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
                公開準備中
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              プライバシーポリシー
            </h1>
            <p className="mt-5 max-w-2xl leading-8 text-slate-700 dark:text-slate-200">
              実際のデータ処理と外部サービスの利用状況を確認し、必要なレビューを終えた正式な本文を一般公開前に掲載します。
            </p>
          </header>

          <section
            aria-labelledby="not-policy-heading"
            className="mt-6 flex items-start gap-4 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <CircleAlert className="mt-1 size-6 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="not-policy-heading" className="font-bold">
                この画面は、正式なプライバシーポリシーではありません
              </h2>
              <p className="mt-2 text-sm leading-7">
                未確定の運営者情報、保存期間、外部送信先などを推測で記載せず、確定後に版と適用日を持つ正本へ置き換えます。
              </p>
            </div>
          </section>

          <section aria-labelledby="requirements-heading" className="mt-12">
            <div className="flex items-start gap-3">
              <ClipboardList
                className="mt-1 size-7 shrink-0 text-violet-700 dark:text-violet-300"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-bold tracking-widest text-violet-700 dark:text-violet-300">
                  公開までに確認すること
                </p>
                <h2 id="requirements-heading" className="mt-2 text-2xl font-black sm:text-3xl">
                  正式な本文に掲載する項目
                </h2>
              </div>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              {publicationRequirements.map(([title, description]) => (
                <article
                  key={title}
                  className="rounded-3xl border border-violet-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <h3 className="font-bold">{title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-12 rounded-3xl bg-slate-900 p-6 text-white sm:p-8 dark:bg-slate-800">
            <h2 className="text-xl font-bold">現在確認できる公開情報</h2>
            <p className="mt-3 leading-7 text-slate-200">
              現在のサービス利用条件と、規約内で案内しているデータ取扱いの範囲は利用規約から確認できます。
            </p>
            <div className="mt-6 flex">
              <a
                href="/terms"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                利用規約を確認する
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
