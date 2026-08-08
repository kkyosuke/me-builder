import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 1つのAccountData Objectを最初に利用したAccountへ永続的に固定する。 */
export const accountDataIdentity = sqliteTable(
  "account_data_identity",
  {
    singleton: integer("singleton").primaryKey(),
    accountId: text("account_id").notNull().unique(),
    legacyImportedAt: integer("legacy_imported_at", { mode: "timestamp" }),
  },
  (table) => [check("account_data_identity_singleton_check", sql`${table.singleton} = 1`)],
);
