import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 個人内容と内部IDを含めない、Production管理一覧の監査記録。 */
export const adminAccountListAudits = sqliteTable(
  "admin_account_list_audits",
  {
    id: text("id").primaryKey(),
    adminReference: text("admin_reference").notNull(),
    queryPresent: integer("query_present", { mode: "boolean" }).notNull(),
    roleFilter: text("role_filter", { enum: ["all", "user", "admin"] }).notNull(),
    statusFilter: text("status_filter", { enum: ["all", "active", "stopped"] }).notNull(),
    sort: text("sort", { enum: ["created", "level", "pieces", "growth"] }).notNull(),
    resultCount: integer("result_count").notNull(),
    total: integer("total").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("admin_account_list_audit_created_idx").on(table.createdAt)],
);
