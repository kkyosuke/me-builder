import { useLiffSession } from "../../liff";
import { AdminStatisticsScreen } from "./admin-statistics-screen";
import { useAdminStatistics } from "./use-admin-statistics";

export default function AdminApplication() {
  const liffSession = useLiffSession();
  const statistics = useAdminStatistics(liffSession.acquireIdToken);
  return (
    <AdminStatisticsScreen
      state={statistics.state}
      isRefreshing={statistics.isRefreshing}
      onReload={() => void statistics.reload()}
    />
  );
}
