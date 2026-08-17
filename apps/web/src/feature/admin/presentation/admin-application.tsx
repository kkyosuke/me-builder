import { useEffect, useState } from "react";
import { AdminAccountsScreen } from "./admin-accounts-screen";
import { AdminNavigation } from "./admin-navigation";
import { AdminStatisticsScreen } from "./admin-statistics-screen";
import { useAdminAccounts } from "./use-admin-accounts";
import { useAdminStatistics } from "./use-admin-statistics";

type AdminTab = "accounts" | "statistics";

function currentTab(): AdminTab {
  return window.location.pathname.startsWith("/admin/statistics") ? "statistics" : "accounts";
}

export default function AdminApplication() {
  const [tab, setTab] = useState(currentTab);

  useEffect(() => {
    const syncTabWithLocation = () => setTab(currentTab());
    window.addEventListener("popstate", syncTabWithLocation);
    return () => window.removeEventListener("popstate", syncTabWithLocation);
  }, []);

  return (
    <main className="mx-auto min-h-dvh w-full min-w-0 max-w-6xl px-4 py-12 sm:px-8">
      <header>
        <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Admin</p>
        <h1 className="text-3xl font-bold">管理者ダッシュボード</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Accountの利用状況とサービス利用量を確認します。
        </p>
        <AdminNavigation current={tab} />
      </header>
      {tab === "statistics" ? <StatisticsApplication /> : <AccountsApplication />}
    </main>
  );
}

function AccountsApplication() {
  const accounts = useAdminAccounts();
  return (
    <AdminAccountsScreen
      state={accounts.state}
      filters={accounts.filters}
      isRefreshing={accounts.isRefreshing}
      pageNumber={accounts.pageNumber}
      canGoBack={accounts.canGoBack}
      onReload={() => void accounts.reload()}
      onFilterChange={accounts.updateFilter}
      onNextPage={accounts.nextPage}
      onPreviousPage={accounts.previousPage}
    />
  );
}

function StatisticsApplication() {
  const statistics = useAdminStatistics();
  return (
    <AdminStatisticsScreen
      state={statistics.state}
      isRefreshing={statistics.isRefreshing}
      onReload={() => void statistics.reload()}
    />
  );
}
