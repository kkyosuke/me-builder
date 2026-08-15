import { BarChart3, Users } from "lucide-react";
import { config } from "../../../config";

export function AdminPreviewNavigation({ current }: { current: "accounts" | "statistics" }) {
  const suffix = config.environment === "preview" ? "" : "?progression-preview=1";
  return (
    <nav
      aria-label="管理者メニュー"
      className="mt-6 border-b border-slate-200 dark:border-slate-700"
    >
      <div className="flex gap-6">
        <a
          href={`/admin${suffix}`}
          aria-current={current === "accounts" ? "page" : undefined}
          className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold ${
            current === "accounts"
              ? "border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          <Users className="size-4" aria-hidden="true" />
          Account
        </a>
        <a
          href={`/admin/statistics${suffix}`}
          aria-current={current === "statistics" ? "page" : undefined}
          className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold ${
            current === "statistics"
              ? "border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          <BarChart3 className="size-4" aria-hidden="true" />
          利用統計
        </a>
      </div>
    </nav>
  );
}
