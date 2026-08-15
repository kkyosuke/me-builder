import type { ReactNode } from "react";
import { ServiceSiteFooter } from "./service-site-footer";
import { ServiceSiteHeader } from "./service-site-header";

export function ServiceSiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#fffdfb] text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-lg bg-slate-950 px-4 py-3 font-bold text-white focus:translate-y-0 motion-reduce:transition-none"
      >
        本文へ移動
      </a>
      <ServiceSiteHeader />
      {children}
      <ServiceSiteFooter />
    </div>
  );
}
