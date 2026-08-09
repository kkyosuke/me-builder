import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "../../../../packages/lib/src/d1/schema/account";

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

/** 相性関係の正本を複製せず、本人の一覧と重複防止に必要な参照だけを持つ。 */
export const compatibilityReferences = sqliteTable(
  "compatibility_references",
  {
    relationshipId: text("relationship_id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    role: text("role", { enum: ["inviter", "invitee"] }).notNull(),
    partnerAccountId: text("partner_account_id"),
    status: text("status", { enum: ["pending", "reserved", "active", "ended"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "compatibility_reference_state_check",
      sql`(${table.status} = 'pending' and ${table.role} = 'inviter' and ${table.partnerAccountId} is null) or (${table.status} = 'reserved' and ${table.partnerAccountId} is not null) or (${table.status} = 'active' and ${table.partnerAccountId} is not null) or ${table.status} = 'ended'`,
    ),
    uniqueIndex("compatibility_reference_active_partner_idx")
      .on(table.partnerAccountId)
      .where(sql`${table.status} in ('reserved', 'active')`),
    index("compatibility_reference_status_updated_idx").on(table.status, table.updatedAt),
  ],
);
