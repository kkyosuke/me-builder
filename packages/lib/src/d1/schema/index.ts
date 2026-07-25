import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Account Domain Table
 */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  status: text("status", { enum: ["active", "deleted"] })
    .notNull()
    .default("active"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Account Identity Table (Multiple login provider credentials per account)
 */
export const accountIdentities = sqliteTable(
  "account_identities",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // e.g. "line", "google", "apple"
    providerAccountId: text("provider_account_id").notNull(), // External provider user ID
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("provider_account_idx").on(table.provider, table.providerAccountId)],
);
