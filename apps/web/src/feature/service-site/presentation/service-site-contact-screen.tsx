import {
  ArrowLeft,
  Bug,
  CircleAlert,
  Database,
  HelpCircle,
  MailQuestion,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { DocumentMetadata } from "../../../components/document-metadata";
import { config } from "../../../config";
import { serviceSitePageMetadata } from "../model/service-site-page-metadata";

const contactCategories = [
  {
    icon: HelpCircle,
    title: "サービスについて",
    description: "利用開始前の質問、使い方、提供している機能について",
  },
  {
    icon: Bug,
    title: "不具合",
    description: "画面が開かない、操作を完了できないなどの技術的な問題について",
  },
  {
    icon: Database,
    title: "データとプライバシー",
    description: "データの取扱い、開示・訂正・削除・利用停止の相談について",
  },
  {
    icon: Scale,
    title: "権利侵害",
    description: "著作権、プライバシー、その他の権利に関する申告について",
  },
] as const;

const sensitiveInformation = [
  "認証token、アクセストークン、パスワード",
  "LINE user IDやAccount ID",
  "日記や診断回答の原文",
  "本人確認書類や、第三者の個人情報",
] as const;

function canonicalUrl(): string | undefined {
  if (!config.baseUrl) return undefined;
  return new URL("/contact", config.baseUrl).toString();
}

export function ServiceSiteContactScreen() {
  const pageCanonicalUrl = canonicalUrl();
  const metadata = serviceSitePageMetadata.contact;

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

          <header className="mt-6 rounded-[2rem] bg-gradient-to-br from-pink-100 via-white to-violet-100 p-6 shadow-sm sm:p-9 dark:from-pink-950/40 dark:via-slate-900 dark:to-violet-950/50">
            <span className="grid size-12 place-items-center rounded-2xl bg-white text-pink-700 shadow-sm dark:bg-slate-800 dark:text-pink-200">
              <MailQuestion className="size-6" aria-hidden="true" />
            </span>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <p className="text-sm font-bold tracking-widest text-pink-800 dark:text-pink-300">
                CONTACT
              </p>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
                窓口準備中
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">お問い合わせ</h1>
            <p className="mt-5 max-w-2xl leading-8 text-slate-700 dark:text-slate-200">
              正式な運営者情報と有効な連絡先を確認し、安全に返信できるお問い合わせ窓口を一般公開前に掲載します。
            </p>
          </header>

          <section
            aria-labelledby="contact-unavailable-heading"
            className="mt-6 flex items-start gap-4 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <CircleAlert className="mt-1 size-6 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="contact-unavailable-heading" className="font-bold">
                現在、この画面からお問い合わせは送信できません
              </h2>
              <p className="mt-2 text-sm leading-7">
                届かない仮のメールアドレスや、取扱いの決まっていないフォームを用意せず、窓口と個人情報の利用目的が確定してから受付を開始します。
              </p>
            </div>
          </section>

          <section aria-labelledby="categories-heading" className="mt-12">
            <p className="text-sm font-bold tracking-widest text-violet-700 dark:text-violet-300">
              お問い合わせ種別
            </p>
            <h2 id="categories-heading" className="mt-2 text-2xl font-black sm:text-3xl">
              公開後は、内容に合った窓口へ案内します
            </h2>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              {contactCategories.map((category) => {
                const Icon = category.icon;
                return (
                  <article
                    key={category.title}
                    className="rounded-3xl border border-violet-100 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <span className="grid size-11 place-items-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-lg font-bold">{category.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                      {category.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>

          <section
            aria-labelledby="sensitive-heading"
            className="mt-12 grid gap-7 rounded-[2rem] bg-rose-950 p-6 text-white sm:p-8 lg:grid-cols-[0.8fr_1.2fr]"
          >
            <div>
              <ShieldAlert className="size-8 text-rose-300" aria-hidden="true" />
              <h2 id="sensitive-heading" className="mt-4 text-2xl font-bold">
                送らないでほしい情報
              </h2>
              <p className="mt-3 text-sm leading-7 text-rose-100">
                問題の確認に必要な場合も、まず窓口から安全な確認方法を案内します。
              </p>
            </div>
            <ul className="grid gap-3">
              {sensitiveInformation.map((item) => (
                <li key={item} className="rounded-2xl bg-white/10 px-4 py-3 text-sm leading-7">
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10 rounded-3xl border border-sky-200 bg-sky-50 p-6 dark:border-sky-900 dark:bg-sky-950/30">
            <h2 className="font-bold text-sky-950 dark:text-sky-100">
              データ削除など、本人確認が必要な手続きについて
            </h2>
            <p className="mt-3 text-sm leading-7 text-sky-900 dark:text-sky-200">
              公開フォームだけでは完了させず、対象Accountの本人であることを安全な方法で確認してから手続きを進めます。本人確認書類を最初の連絡へ添付しないでください。
            </p>
          </section>

          <nav aria-label="関連する公開情報" className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a
              href="/terms"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-violet-700 px-5 text-sm font-bold text-white hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              利用規約を確認する
            </a>
            <a
              href="/privacy"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-violet-300 px-5 text-sm font-bold text-violet-800 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-violet-700 dark:text-violet-200 dark:hover:bg-violet-950/40"
            >
              プライバシー情報を確認する
            </a>
          </nav>
        </div>
      </main>
    </>
  );
}
