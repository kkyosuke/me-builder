import { AdminAccountsScreen } from "./admin-accounts-screen";
import { AdminStatisticsScreen } from "./admin-statistics-screen";
import { useAdminAccounts } from "./use-admin-accounts";
import { useAdminStatistics } from "./use-admin-statistics";

export default function AdminApplication() {
  if (window.location.pathname.startsWith("/admin/statistics")) {
    return <StatisticsApplication />;
  }
  return <AccountsApplication />;
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
      showNavigation
      onReload={() => void statistics.reload()}
    />
  );
}
