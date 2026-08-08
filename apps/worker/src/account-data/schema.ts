import { d1 } from "@me-builder/lib";
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 1つのAccountData Objectを最初に利用したAccountへ永続的に固定する。 */
export const accountDataIdentity = sqliteTable(
  "account_data_identity",
  {
    singleton: integer("singleton").primaryKey(),
    accountId: text("account_id").notNull().unique(),
  },
  (table) => [check("account_data_identity_singleton_check", sql`${table.singleton} = 1`)],
);

// AccountData内の所有FKが参照するlocal owner row。外部Identityは共有D1だけに置く。
export const accounts = d1.schema.accounts;
