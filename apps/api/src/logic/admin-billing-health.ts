import { D1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  adminLineUserIds: readonly string[];
  db: D1.shared.Client;
  staleAfterMs: number;
  now?: Date;
  createSession?: typeof createLiffSession;
};

export async function getAdminBillingHealth(params: Params) {
  const session = await (params.createSession ?? createLiffSession)({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    adminLineUserIds: params.adminLineUserIds,
    db: params.db,
  });
  if (session.type !== "resolved") return { type: session.type } as const;
  if (session.session.role !== "admin") return { type: "forbidden" } as const;
  const now = params.now ?? new Date();
  const summary = await D1.shared.action.billing.getBillingOperationalSummary(params.db, {
    now,
    staleAfterMs: params.staleAfterMs,
  });
  const degraded =
    summary.staleProjectionCount > 0 ||
    summary.customerWithoutProjectionCount > 0 ||
    summary.projectionWithoutPlanCount > 0;
  return {
    type: "resolved",
    health: {
      status: degraded ? ("degraded" as const) : ("healthy" as const),
      checkedAt: now.toISOString(),
      ...summary,
    },
  } as const;
}
