import { LineFriendAddButton } from "./line-friend-add-button";

const navigationItems = [
  { href: "/#features", label: "できること" },
  { href: "/#how-it-works", label: "使い方" },
  { href: "/#safety", label: "安心して使う" },
  { href: "/#plans", label: "プラン" },
  { href: "/#faq", label: "よくある質問" },
] as const;

export function ServiceSiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-violet-100/80 bg-white/90 backdrop-blur-xl dark:border-slate-700 dark:bg-slate-950/90">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <a
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl font-bold tracking-wide text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-white"
        >
          <img
            src="/images/service/brand-mark.png"
            alt=""
            width="36"
            height="36"
            className="size-9 object-contain"
          />
          かがみ
        </a>
        <nav aria-label="サービス紹介" className="ml-auto hidden items-center gap-1 lg:flex">
          {navigationItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-violet-50 hover:text-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <LineFriendAddButton className="ml-auto shrink-0 lg:ml-3" />
      </div>
    </header>
  );
}
