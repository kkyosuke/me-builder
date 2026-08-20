type AdminAccountProgression =
  | Readonly<{
      status: "ready";
      level: number;
      calculationVersion: number;
      collectedPieces: number;
      activePieces: number;
      lastGrowthAt: string | null;
      projectedAt: string;
    }>
  | Readonly<{ status: "pending" }>;

export type AdminAccount = Readonly<{
  adminReference: string;
  role: "user" | "admin";
  status: "active" | "stopped";
  createdAt: string;
  lastActivityAt: string;
  plan: "free" | "lite" | "full" | "family";
  progression: AdminAccountProgression;
}>;

export type AdminAccountPage = Readonly<{
  accounts: readonly AdminAccount[];
  total: number;
  nextCursor: string | null;
}>;

export type AdminAccountFilters = Readonly<{
  query: string;
  role: "all" | AdminAccount["role"];
  status: "all" | AdminAccount["status"];
  sort: "created" | "level" | "pieces" | "growth";
}>;
