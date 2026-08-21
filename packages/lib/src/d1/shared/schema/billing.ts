import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./account";

export const billingCustomers = sqliteTable(
  "billing_customers",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id),
    providerCustomerId: text("provider_customer_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  },
  (table) => [uniqueIndex("billing_customer_provider_idx").on(table.providerCustomerId)],
);

export const billingSubscriptionProjections = sqliteTable(
  "billing_subscription_projections",
  {
    providerSubscriptionId: text("provider_subscription_id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    providerCustomerId: text("provider_customer_id").notNull(),
    status: text("status", {
      enum: [
        "unknown",
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "paused",
      ],
    }).notNull(),
    planCode: text("plan_code", { enum: ["free", "lite", "full", "family"] }),
    currentPeriodStart: integer("current_period_start", { mode: "timestamp" }),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    trialEnd: integer("trial_end", { mode: "timestamp" }),
    paymentFailureStartedAt: integer("payment_failure_started_at", { mode: "timestamp" }),
    paymentFailurePlanCode: text("payment_failure_plan_code", {
      enum: ["free", "lite", "full", "family"],
    }),
    providerCreatedAt: integer("provider_created_at", { mode: "timestamp" }).notNull(),
    lastEventCreatedAt: integer("last_event_created_at", { mode: "timestamp" }).notNull(),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("billing_subscription_customer_idx").on(table.providerCustomerId),
    index("billing_subscription_account_idx").on(table.accountId),
    check(
      "billing_subscription_period_check",
      sql`${table.currentPeriodStart} is null or ${table.currentPeriodEnd} is null or ${table.currentPeriodStart} <= ${table.currentPeriodEnd}`,
    ),
  ],
);

export const billingProcessedEvents = sqliteTable(
  "billing_processed_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    objectId: text("object_id").notNull(),
    eventCreatedAt: integer("event_created_at", { mode: "timestamp" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp" }).notNull(),
    disposition: text("disposition", { enum: ["applied", "stale", "ignored"] }).notNull(),
  },
  (table) => [index("billing_processed_object_idx").on(table.objectId, table.eventCreatedAt)],
);

/** Customerを作り直しても失われない、Account単位の初回trial開始記録。 */
export const billingTrialUsages = sqliteTable(
  "billing_trial_usages",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    firstStartedAt: integer("first_started_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("billing_trial_subscription_idx").on(table.providerSubscriptionId)],
);

export const billingReconciliationAudits = sqliteTable(
  "billing_reconciliation_audits",
  {
    operationId: text("operation_id").primaryKey(),
    adminAccountId: text("admin_account_id")
      .notNull()
      .references(() => accounts.id),
    targetAccountId: text("target_account_id")
      .notNull()
      .references(() => accounts.id),
    mode: text("mode", { enum: ["dry-run", "apply"] }).notNull(),
    differenceFields: text("difference_fields", { mode: "json" }).$type<string[]>().notNull(),
    result: text("result", { enum: ["no-difference", "difference", "repaired"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("billing_reconciliation_target_idx").on(table.targetAccountId, table.createdAt),
  ],
);
