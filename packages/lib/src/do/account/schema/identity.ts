import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 1つのAccountData Objectを最初に利用したAccountへ永続的に固定する。
 *
 * Account所有rootはこのidentityへ外部キーを張る。共有D1のAccount行を複製しないため、
 * 利用停止・role・退会はAccountData側に現れない。
 */
export const accountDataIdentity = sqliteTable(
  "account_data_identity",
  {
    singleton: integer("singleton").primaryKey(),
    accountId: text("account_id").notNull().unique(),
  },
  (table) => [check("account_data_identity_singleton_check", sql`${table.singleton} = 1`)],
);
