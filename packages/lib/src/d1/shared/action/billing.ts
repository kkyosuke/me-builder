import { logger } from "@me-builder/shared";
import { and, eq, gt } from "drizzle-orm";
import type {
  AccountPlanAssignment,
  AccountPlanAssignmentProvider,
  BillingSubscription,
  PlanCode,
} from "../../../billing";
import { freePlanAssignment } from "../../../billing";
import type { SharedD1Client } from "../client";
import {
  billingCustomers,
  billingProcessedEvents,
  billingReconciliationAudits,
  billingSubscriptionProjections,
  billingTrialUsages,
} from "../schema/billing";

export const BILLING_PAYMENT_FAILURE_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;

export class BillingCustomerOwnershipError extends Error {
  constructor() {
    super("BILLING_CUSTOMER_OWNERSHIP_CONFLICT");
    this.name = "BillingCustomerOwnershipError";
  }
}

export async function linkBillingCustomer(
  db: SharedD1Client,
  input: { accountId: string; providerCustomerId: string; syncedAt?: Date },
) {
  const syncedAt = input.syncedAt ?? new Date();
  const [byAccount, byCustomer] = await Promise.all([
    db.query.billingCustomers.findFirst({
      where: (table, { eq }) => eq(table.accountId, input.accountId),
    }),
    db.query.billingCustomers.findFirst({
      where: (table, { eq }) => eq(table.providerCustomerId, input.providerCustomerId),
    }),
  ]);
  if (
    (byAccount && byAccount.providerCustomerId !== input.providerCustomerId) ||
    (byCustomer && byCustomer.accountId !== input.accountId)
  ) {
    throw new BillingCustomerOwnershipError();
  }
  await db
    .insert(billingCustomers)
    .values({
      accountId: input.accountId,
      providerCustomerId: input.providerCustomerId,
      createdAt: syncedAt,
      updatedAt: syncedAt,
      lastSyncedAt: syncedAt,
    })
    .onConflictDoUpdate({
      target: billingCustomers.accountId,
      set: { updatedAt: syncedAt, lastSyncedAt: syncedAt },
    });
  return await db.query.billingCustomers.findFirst({
    where: (table, { eq }) => eq(table.accountId, input.accountId),
  });
}

/**
 * Stripe側で削除済み、または現在のsandboxに存在しないCustomerを、
 * 呼び出し側が確認した旧IDとのCASで置き換える。
 * 有効な契約がないことの確認はproviderの現在状態を知るapplication層が担う。
 */
export async function replaceBillingCustomer(
  db: SharedD1Client,
  input: {
    accountId: string;
    expectedProviderCustomerId: string;
    providerCustomerId: string;
    syncedAt?: Date;
  },
) {
  const syncedAt = input.syncedAt ?? new Date();
  const ownedByAnotherAccount = await db.query.billingCustomers.findFirst({
    where: (table, { eq }) => eq(table.providerCustomerId, input.providerCustomerId),
  });
  if (ownedByAnotherAccount && ownedByAnotherAccount.accountId !== input.accountId) {
    throw new BillingCustomerOwnershipError();
  }
  await db
    .update(billingCustomers)
    .set({
      providerCustomerId: input.providerCustomerId,
      updatedAt: syncedAt,
      lastSyncedAt: syncedAt,
    })
    .where(
      and(
        eq(billingCustomers.accountId, input.accountId),
        eq(billingCustomers.providerCustomerId, input.expectedProviderCustomerId),
      ),
    );
  const customer = await db.query.billingCustomers.findFirst({
    where: (table, { eq }) => eq(table.accountId, input.accountId),
  });
  if (customer?.providerCustomerId !== input.providerCustomerId) {
    throw new BillingCustomerOwnershipError();
  }
  return customer;
}

export async function findBillingCustomerByAccount(db: SharedD1Client, accountId: string) {
  return await db.query.billingCustomers.findFirst({
    where: (table, { eq }) => eq(table.accountId, accountId),
  });
}

export async function findBillingCustomerByProviderCustomerId(
  db: SharedD1Client,
  providerCustomerId: string,
) {
  return await db.query.billingCustomers.findFirst({
    where: (table, { eq }) => eq(table.providerCustomerId, providerCustomerId),
  });
}

export async function findBillingProjectionByAccount(db: SharedD1Client, accountId: string) {
  return await db.query.billingSubscriptionProjections.findFirst({
    where: (table, { eq }) => eq(table.accountId, accountId),
  });
}

export async function hasUsedBillingTrial(db: SharedD1Client, accountId: string): Promise<boolean> {
  return Boolean(
    await db.query.billingTrialUsages.findFirst({
      where: (table, { eq }) => eq(table.accountId, accountId),
    }),
  );
}

export type BillingOperationalSummary = Readonly<{
  customerCount: number;
  activeSubscriptionCount: number;
  staleProjectionCount: number;
  customerWithoutProjectionCount: number;
  projectionWithoutPlanCount: number;
  statusCounts: Partial<Record<BillingSubscription["status"], number>>;
  planCounts: Partial<Record<PlanCode, number>>;
}>;

export async function getBillingOperationalSummary(
  db: SharedD1Client,
  input: { now?: Date; staleAfterMs: number },
): Promise<BillingOperationalSummary> {
  const now = input.now ?? new Date();
  const [customers, projections] = await Promise.all([
    db.select().from(billingCustomers).all(),
    db.select().from(billingSubscriptionProjections).all(),
  ]);
  const projectedCustomerIds = new Set(
    projections.map((projection) => projection.providerCustomerId),
  );
  const statusCounts: BillingOperationalSummary["statusCounts"] = {};
  const planCounts: BillingOperationalSummary["planCounts"] = {};
  for (const projection of projections) {
    statusCounts[projection.status] = (statusCounts[projection.status] ?? 0) + 1;
    if (projection.planCode)
      planCounts[projection.planCode] = (planCounts[projection.planCode] ?? 0) + 1;
  }
  return {
    customerCount: customers.length,
    activeSubscriptionCount: projections.filter(
      (projection) => projection.status === "active" || projection.status === "trialing",
    ).length,
    staleProjectionCount: projections.filter(
      (projection) =>
        projection.status !== "canceled" &&
        projection.status !== "incomplete_expired" &&
        now.getTime() - projection.lastSyncedAt.getTime() > input.staleAfterMs,
    ).length,
    customerWithoutProjectionCount: customers.filter(
      (customer) =>
        !projectedCustomerIds.has(customer.providerCustomerId) &&
        now.getTime() - customer.createdAt.getTime() > input.staleAfterMs,
    ).length,
    projectionWithoutPlanCount: projections.filter(
      (projection) =>
        (projection.status === "active" || projection.status === "trialing") &&
        projection.planCode === null,
    ).length,
    statusCounts,
    planCounts,
  };
}

export async function expireBillingProjection(
  db: SharedD1Client,
  accountId: string,
  at = new Date(),
): Promise<void> {
  await db
    .update(billingSubscriptionProjections)
    .set({
      status: "canceled",
      planCode: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: at,
      lastEventCreatedAt: at,
      lastSyncedAt: at,
      updatedAt: at,
    })
    .where(eq(billingSubscriptionProjections.accountId, accountId));
}

export async function recordBillingReconciliationAudit(
  db: SharedD1Client,
  input: typeof billingReconciliationAudits.$inferInsert,
): Promise<void> {
  await db.insert(billingReconciliationAudits).values(input);
}

export type ApplyBillingProjectionInput = {
  accountId: string;
  event: { id: string; type: string; objectId: string; createdAt: Date };
  subscription: BillingSubscription;
  planCode: PlanCode | null;
  syncedAt?: Date;
};

export async function applyBillingProjection(
  db: SharedD1Client,
  input: ApplyBillingProjectionInput,
): Promise<"applied" | "duplicate" | "stale"> {
  const processed = await db.query.billingProcessedEvents.findFirst({
    where: (table, { eq }) => eq(table.eventId, input.event.id),
  });
  if (processed) return "duplicate";

  const owner = await db.query.billingCustomers.findFirst({
    where: (table, { eq }) => eq(table.providerCustomerId, input.subscription.customerId),
  });
  if (!owner || owner.accountId !== input.accountId) {
    throw new BillingCustomerOwnershipError();
  }
  const current = await db.query.billingSubscriptionProjections.findFirst({
    where: (table, { eq }) => eq(table.providerCustomerId, input.subscription.customerId),
  });
  const disposition =
    current && current.lastEventCreatedAt.getTime() > input.event.createdAt.getTime()
      ? "stale"
      : "applied";
  const syncedAt = input.syncedAt ?? new Date();
  const eventInsert = db.insert(billingProcessedEvents).values({
    eventId: input.event.id,
    eventType: input.event.type,
    objectId: input.event.objectId,
    eventCreatedAt: input.event.createdAt,
    processedAt: syncedAt,
    disposition,
  });
  const trialUsageInsert = input.subscription.trialEnd
    ? db
        .insert(billingTrialUsages)
        .values({
          accountId: input.accountId,
          providerSubscriptionId: input.subscription.id,
          firstStartedAt:
            parseDate(input.subscription.currentPeriodStart) ??
            new Date(input.subscription.createdAt),
          createdAt: syncedAt,
        })
        .onConflictDoNothing()
    : null;
  if (disposition === "stale") {
    if (trialUsageInsert) await db.batch([eventInsert, trialUsageInsert]);
    else await eventInsert;
    return disposition;
  }

  const values: typeof billingSubscriptionProjections.$inferInsert = {
    providerSubscriptionId: input.subscription.id,
    accountId: input.accountId,
    providerCustomerId: input.subscription.customerId,
    status: input.subscription.status,
    planCode: input.planCode,
    currentPeriodStart: parseDate(input.subscription.currentPeriodStart),
    currentPeriodEnd: parseDate(input.subscription.currentPeriodEnd),
    cancelAtPeriodEnd: input.subscription.cancelAtPeriodEnd,
    trialEnd: parseDate(input.subscription.trialEnd),
    paymentFailureStartedAt:
      input.subscription.status === "past_due"
        ? current?.status === "past_due"
          ? (current.paymentFailureStartedAt ?? input.event.createdAt)
          : input.event.createdAt
        : null,
    paymentFailurePlanCode:
      input.subscription.status === "past_due"
        ? current?.status === "past_due"
          ? (current.paymentFailurePlanCode ?? current.planCode ?? input.planCode)
          : (current?.planCode ?? input.planCode)
        : null,
    providerCreatedAt: new Date(input.subscription.createdAt),
    lastEventCreatedAt: input.event.createdAt,
    lastSyncedAt: syncedAt,
    createdAt: current?.createdAt ?? syncedAt,
    updatedAt: syncedAt,
  };
  await db.batch([
    eventInsert,
    db.insert(billingSubscriptionProjections).values(values).onConflictDoUpdate({
      target: billingSubscriptionProjections.providerCustomerId,
      set: values,
    }),
    ...(trialUsageInsert ? [trialUsageInsert] : []),
  ]);
  return disposition;
}

function parseDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

export class D1AccountPlanAssignmentProvider implements AccountPlanAssignmentProvider {
  constructor(private readonly db: SharedD1Client) {}

  async findCurrent(accountId: string, at = new Date()): Promise<AccountPlanAssignment> {
    let rows: Array<typeof billingSubscriptionProjections.$inferSelect>;
    try {
      rows = await this.db
        .select()
        .from(billingSubscriptionProjections)
        .where(
          and(
            eq(billingSubscriptionProjections.accountId, accountId),
            gt(billingSubscriptionProjections.currentPeriodEnd, at),
          ),
        )
        .all();
    } catch {
      logger.error(
        {
          event: "billing.plan-assignment.degraded",
          service: "lib",
          errorCode: "BILLING_PROJECTION_READ_FAILED",
          outcome: "degraded",
          disposition: "free-plan-fallback",
        },
        "[Billing assignment] projection read failed -> Free fallback",
      );
      return freePlanAssignment(accountId, at);
    }
    const current = rows
      .filter((row) => isEntitledBillingProjection(row, at))
      .sort(
        (left, right) =>
          (right.currentPeriodEnd?.getTime() ?? 0) - (left.currentPeriodEnd?.getTime() ?? 0),
      )[0];
    const entitledPlan =
      current?.status === "past_due"
        ? (current.paymentFailurePlanCode ?? current.planCode)
        : current?.planCode;
    if (!entitledPlan || !current?.currentPeriodStart || !current.currentPeriodEnd) {
      return freePlanAssignment(accountId, at);
    }
    return {
      accountId,
      plan: entitledPlan,
      source: "subscription",
      effectiveAt: current.currentPeriodStart.toISOString(),
      availableUntil:
        current.status === "past_due" && current.paymentFailureStartedAt
          ? new Date(
              Math.min(
                current.currentPeriodEnd.getTime(),
                current.paymentFailureStartedAt.getTime() + BILLING_PAYMENT_FAILURE_GRACE_MS,
              ),
            ).toISOString()
          : current.currentPeriodEnd.toISOString(),
      payerAccountId: accountId,
    };
  }
}

function isEntitledBillingProjection(
  row: typeof billingSubscriptionProjections.$inferSelect,
  at: Date,
): boolean {
  if (row.planCode === null) return false;
  if (row.status === "active" || row.status === "trialing") return true;
  return (
    row.status === "past_due" &&
    row.paymentFailureStartedAt !== null &&
    at.getTime() < row.paymentFailureStartedAt.getTime() + BILLING_PAYMENT_FAILURE_GRACE_MS
  );
}
