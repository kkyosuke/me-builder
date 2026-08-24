import { serviceOperator } from "@me-builder/shared";
import { currentServiceSitePublication } from "../../model/service-site-publication-policy";

export function ServiceSiteFooter() {
  return (
    <footer className="border-t border-violet-100 bg-white dark:border-slate-700 dark:bg-slate-950">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] lg:px-8">
        <div>
          <a
            href="/"
            className="rounded-lg text-lg font-bold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-white"
          >
            かがみ
          </a>
          <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            LINEの日記とWebの診断から、自分の考え方や大切にしていることを少しずつ振り返るサービスです。
          </p>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {serviceOperator.displayName}
          </p>
        </div>
        <nav aria-label="フッターナビゲーション" className="grid content-start gap-3 text-sm">
          <a className="font-semibold hover:underline" href="/terms">
            利用規約
          </a>
          <a className="font-semibold hover:underline" href="/privacy">
            プライバシーポリシー
          </a>
          {currentServiceSitePublication.showCommercialTransactions && (
            <a className="font-semibold hover:underline" href="/commercial-transactions">
              特定商取引法に基づく表記
            </a>
          )}
          <a className="font-semibold hover:underline" href="/contact">
            お問い合わせ
          </a>
        </nav>
      </div>
      <p className="border-t border-violet-100 px-4 py-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        © 2026 かがみ
      </p>
    </footer>
  );
}
