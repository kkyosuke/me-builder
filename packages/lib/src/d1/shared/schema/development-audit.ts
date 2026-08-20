import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 個人内容・Account ID・job IDを含めない開発用破壊操作の監査記録。 */
export const developmentOperationAudits = sqliteTable(
  "development_operation_audits",
  {
    id: text("id").primaryKey(),
    operation: text("operation", {
      enum: ["account-data-reset", "brain-vector-single-reset", "brain-vector-bulk-reset"],
    }).notNull(),
    result: text("result", { enum: ["succeeded"] }).notNull(),
    affectedCount: integer("affected_count").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("development_operation_audit_created_idx").on(table.createdAt)],
);
