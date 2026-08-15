import { config } from "../../../config";
import { shouldShowProgressionPreview } from "../../../model/progression-preview";
import { useLiffSession } from "../../liff";
import type { AdminAccountPage } from "../model/account";
import { AdminAccountsScreen } from "./admin-accounts-screen";
import { AdminStatisticsScreen } from "./admin-statistics-screen";
import { useAdminStatistics } from "./use-admin-statistics";

const previewAccounts: AdminAccountPage = {
  total: 3,
  nextCursor: null,
  accounts: [
    {
      id: "acc_01HZX4A8MXGQK7N3W2C9F6RTPV",
      displayName: "佐藤 あかり",
      role: "user",
      status: "active",
      createdAt: "2026-08-12T03:30:00.000Z",
      progression: {
        status: "ready",
        level: 12,
        calculationVersion: 1,
        collectedPieces: 58,
        activePieces: 48,
        lastGrowthAt: "2026-08-14T09:42:00.000Z",
        projectedAt: "2026-08-14T09:42:03.000Z",
      },
    },
    {
      id: "acc_01HZVQKX80P4G2Y7C6N5MJ9RTE",
      displayName: "高橋 直樹",
      role: "admin",
      status: "active",
      createdAt: "2026-07-28T11:05:00.000Z",
      progression: {
        status: "ready",
        level: 7,
        calculationVersion: 1,
        collectedPieces: 31,
        activePieces: 27,
        lastGrowthAt: null,
        projectedAt: "2026-08-13T02:10:00.000Z",
      },
    },
    {
      id: "acc_01HZP3Q7T5KC8F2M4N6RVX9WAE",
      displayName: null,
      role: "user",
      status: "active",
      createdAt: "2026-07-19T06:20:00.000Z",
      progression: { status: "pending" },
    },
  ],
};

function progressionPreviewEnabled(): boolean {
  return shouldShowProgressionPreview(config.environment, window.location.search);
}

export default function AdminApplication() {
  const previewEnabled = progressionPreviewEnabled();

  if (previewEnabled && !window.location.pathname.startsWith("/admin/statistics")) {
    return (
      <AdminAccountsScreen
        state={{ status: "success", data: previewAccounts }}
        onReload={() => window.location.reload()}
      />
    );
  }
  return <StatisticsApplication showPreviewNavigation={previewEnabled} />;
}

function StatisticsApplication({ showPreviewNavigation }: { showPreviewNavigation: boolean }) {
  const liffSession = useLiffSession();
  const statistics = useAdminStatistics(liffSession.acquireIdToken);
  return (
    <AdminStatisticsScreen
      state={statistics.state}
      isRefreshing={statistics.isRefreshing}
      showPreviewNavigation={showPreviewNavigation}
      onReload={() => void statistics.reload()}
    />
  );
}
