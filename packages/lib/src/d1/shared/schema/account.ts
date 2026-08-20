import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";

/**
 * Account Domain Table
 */
export const accounts = sqliteTable("accounts", {
  ...baseSchema,
  status: text("status", { enum: ["active", "stopped"] })
    .notNull()
    .default("active"),
  role: text("role", { enum: ["user", "admin"] })
    .notNull()
    .default("user"),
  sessionVersion: integer("session_version").notNull().default(1),
  lastActivityAt: integer("last_activity_at", { mode: "timestamp" }),
});

/**
 * Account Identity Table (Multiple login provider credentials per account)
 */
export const accountIdentities = sqliteTable(
  "account_identities",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    provider: text("provider").notNull(), // e.g. "line", "google", "apple"
    providerAccountId: text("provider_account_id").notNull(), // External provider user ID
  },
  (table) => [
    uniqueIndex("provider_account_active_idx")
      .on(table.provider, table.providerAccountId)
      .where(sql`is_deleted = 0`),
  ],
);
