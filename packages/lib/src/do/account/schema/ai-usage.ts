import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accountDataIdentity } from "./identity";

export const aiUsageKinds = ["ai-reply", "profile-summary"] as const;
export type AiUsageKind = (typeof aiUsageKinds)[number];

export const aiUsageStatuses = ["reserved", "committed", "released"] as const;
export type AiUsageStatus = (typeof aiUsageStatuses)[number];

/** AI上限の予約から確定・解放までをrequest単位で追跡するAccount内ledger。 */
export const aiUsageRecords = sqliteTable(
  "ai_usage_records",
  {
    requestId: text("request_id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    kind: text("kind", { enum: aiUsageKinds }).notNull(),
    periodKey: text("period_key").notNull(),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
    limitSnapshot: integer("limit_snapshot").notNull(),
    status: text("status", { enum: aiUsageStatuses }).notNull(),
    reservedAt: integer("reserved_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    committedAt: integer("committed_at", { mode: "timestamp_ms" }),
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
    releaseReason: text("release_reason", { enum: ["cancelled", "timeout"] }),
  },
  (table) => [
    index("ai_usage_account_period_status_idx").on(
      table.accountId,
      table.kind,
      table.periodKey,
      table.status,
    ),
    index("ai_usage_reserved_expiry_idx").on(table.status, table.expiresAt),
    check("ai_usage_period_order_check", sql`${table.periodStart} < ${table.periodEnd}`),
    check("ai_usage_limit_non_negative_check", sql`${table.limitSnapshot} >= 0`),
  ],
);
