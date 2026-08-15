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
  billingSubscriptionProjections,
} from "../schema/billing";

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

export async function findBillingCustomerByAccount(db: SharedD1Client, accountId: string) {
  return await db.query.billingCustomers.findFirst({
    where: (table, { eq }) => eq(table.accountId, accountId),
  });
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

  const current = await db.query.billingSubscriptionProjections.findFirst({
    where: (table, { eq }) => eq(table.providerSubscriptionId, input.subscription.id),
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
  if (disposition === "stale") {
    await eventInsert;
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
    providerCreatedAt: new Date(input.subscription.createdAt),
    lastEventCreatedAt: input.event.createdAt,
    lastSyncedAt: syncedAt,
    createdAt: current?.createdAt ?? syncedAt,
    updatedAt: syncedAt,
  };
  await db.batch([
    eventInsert,
    db.insert(billingSubscriptionProjections).values(values).onConflictDoUpdate({
      target: billingSubscriptionProjections.providerSubscriptionId,
      set: values,
    }),
  ]);
  return disposition;
}

function parseDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

export class D1AccountPlanAssignmentProvider implements AccountPlanAssignmentProvider {
  constructor(private readonly db: SharedD1Client) {}

  async findCurrent(accountId: string, at = new Date()): Promise<AccountPlanAssignment> {
    const rows = await this.db
      .select()
      .from(billingSubscriptionProjections)
      .where(
        and(
          eq(billingSubscriptionProjections.accountId, accountId),
          gt(billingSubscriptionProjections.currentPeriodEnd, at),
        ),
      )
      .all();
    const current = rows
      .filter(
        (row) => (row.status === "active" || row.status === "trialing") && row.planCode !== null,
      )
      .sort(
        (left, right) =>
          (right.currentPeriodEnd?.getTime() ?? 0) - (left.currentPeriodEnd?.getTime() ?? 0),
      )[0];
    if (!current?.planCode || !current.currentPeriodStart || !current.currentPeriodEnd) {
      return freePlanAssignment(accountId, at);
    }
    return {
      accountId,
      plan: current.planCode,
      source: "subscription",
      effectiveAt: current.currentPeriodStart.toISOString(),
      availableUntil: current.currentPeriodEnd.toISOString(),
      payerAccountId: accountId,
    };
  }
}
