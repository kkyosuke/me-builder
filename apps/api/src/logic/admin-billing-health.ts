import { D1 } from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type Params = {
  actor: AuthenticatedActor;
  db: D1.shared.Client;
  staleAfterMs: number;
  now?: Date;
};

export async function getAdminBillingHealth(params: Params) {
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
