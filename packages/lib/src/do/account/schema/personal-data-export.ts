import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accountDataIdentity } from "./identity";

/** 本人データarchiveの非同期生成状態。archive本文は期限切れ時に消去する。 */
export const personalDataExports = sqliteTable(
  "personal_data_exports",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    status: text("status", {
      enum: ["queued", "generating", "ready", "failed", "expired"],
    }).notNull(),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    archiveJson: text("archive_json", { mode: "json" }).$type<unknown>(),
    failureCode: text("failure_code"),
  },
  (table) => [
    uniqueIndex("personal_data_export_active_account_idx")
      .on(table.accountId)
      .where(sql`${table.status} in ('queued', 'generating')`),
    index("personal_data_export_account_requested_idx").on(table.accountId, table.requestedAt),
  ],
);
