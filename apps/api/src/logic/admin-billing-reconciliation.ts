import { D1, type billing } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { createLiffSession } from "./liff-session";

type Mode = "dry-run" | "apply";
type ReconciliationResult = {
  operationId: string;
  mode: Mode;
  differenceFields: string[];
  repaired: boolean;
};

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  adminLineUserIds: readonly string[];
  db: D1.shared.Client;
  provider: billing.BillingProvider;
  accountId: string;
  mode: Mode;
  pricePlanMap: Readonly<Record<string, "lite" | "full" | "family">>;
  now?: Date;
  createSession?: typeof createLiffSession;
};

export type AdminBillingReconciliationOutcome =
  | { type: "not-configured" | "unauthenticated" | "account-not-found" | "forbidden" }
  | { type: "customer-not-found" }
  | { type: "resolved"; reconciliation: ReconciliationResult };

export async function reconcileAdminBillingProjection(
  params: Params,
): Promise<AdminBillingReconciliationOutcome> {
  const session = await (params.createSession ?? createLiffSession)({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    adminLineUserIds: params.adminLineUserIds,
    db: params.db,
  });
  if (session.type !== "resolved") return { type: session.type };
  if (session.session.role !== "admin") return { type: "forbidden" };

  const customer = await D1.shared.action.billing.findBillingCustomerByAccount(
    params.db,
    params.accountId,
  );
  if (!customer) return { type: "customer-not-found" };
  const subscriptions = await params.provider.listSubscriptions(customer.providerCustomerId);
  const current = [...subscriptions].sort((left, right) => {
    const leftCurrent = left.status === "active" || left.status === "trialing" ? 1 : 0;
    const rightCurrent = right.status === "active" || right.status === "trialing" ? 1 : 0;
    return rightCurrent - leftCurrent || Date.parse(right.createdAt) - Date.parse(left.createdAt);
  })[0];
  const actual = await D1.shared.action.billing.findBillingProjectionByAccount(
    params.db,
    params.accountId,
  );
  const expectedPlan = current?.priceId ? (params.pricePlanMap[current.priceId] ?? null) : null;
  const differenceFields = compareProjection(current, expectedPlan, actual);
  const operationId = crypto.randomUUID();
  const now = params.now ?? new Date();
  let repaired = false;
  if (params.mode === "apply" && differenceFields.length > 0) {
    if (current) {
      await D1.shared.action.billing.applyBillingProjection(params.db, {
        accountId: params.accountId,
        event: {
          id: `reconcile-${operationId}`,
          type: "admin.reconciliation",
          objectId: current.id,
          createdAt: now,
        },
        subscription: current,
        planCode: expectedPlan,
        syncedAt: now,
      });
    } else {
      await D1.shared.action.billing.expireBillingProjection(params.db, params.accountId, now);
    }
    const repairedProjection = await D1.shared.action.billing.findBillingProjectionByAccount(
      params.db,
      params.accountId,
    );
    repaired = compareProjection(current, expectedPlan, repairedProjection).length === 0;
  }
  const result =
    differenceFields.length === 0 ? "no-difference" : repaired ? "repaired" : "difference";
  await D1.shared.action.billing.recordBillingReconciliationAudit(params.db, {
    operationId,
    adminAccountId: session.session.accountId,
    targetAccountId: params.accountId,
    mode: params.mode,
    differenceFields,
    result,
    createdAt: now,
  });
  logger.info(
    {
      event: "admin.billing.reconciled",
      adminAccountId: session.session.accountId,
      targetAccountId: params.accountId,
      operationId,
      mode: params.mode,
      differenceCount: differenceFields.length,
      result,
    },
    "Admin reconciled billing projection",
  );
  return {
    type: "resolved",
    reconciliation: { operationId, mode: params.mode, differenceFields, repaired },
  };
}

function compareProjection(
  expected: billing.BillingSubscription | undefined,
  expectedPlan: billing.PlanCode | null,
  actual: Awaited<ReturnType<typeof D1.shared.action.billing.findBillingProjectionByAccount>>,
): string[] {
  if (!expected) {
    if (!actual) return [];
    return [
      ...(actual.status === "canceled" ? [] : ["status"]),
      ...(actual.planCode === null ? [] : ["plan"]),
    ];
  }
  if (!actual) return ["projection"];
  return [
    ...(actual.providerSubscriptionId === expected.id ? [] : ["subscription"]),
    ...(actual.status === expected.status ? [] : ["status"]),
    ...(actual.planCode === expectedPlan ? [] : ["plan"]),
    ...(sameDate(actual.currentPeriodStart, expected.currentPeriodStart) ? [] : ["periodStart"]),
    ...(sameDate(actual.currentPeriodEnd, expected.currentPeriodEnd) ? [] : ["periodEnd"]),
    ...(actual.cancelAtPeriodEnd === expected.cancelAtPeriodEnd ? [] : ["cancelAtPeriodEnd"]),
    ...(sameDate(actual.trialEnd, expected.trialEnd) ? [] : ["trialEnd"]),
  ];
}

function sameDate(actual: Date | null, expected: string | null): boolean {
  return (
    actual?.toISOString() === (expected ?? undefined) || (actual === null && expected === null)
  );
}
