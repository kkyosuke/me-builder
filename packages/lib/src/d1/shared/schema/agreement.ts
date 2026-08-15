import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";
import { accounts } from "./account";

/** Accountが同意した法的文書の版を、上書きせず履歴として保持する。 */
export const accountAgreementAcceptances = sqliteTable(
  "account_agreement_acceptances",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    documentKey: text("document_key", { enum: ["terms_of_service"] }).notNull(),
    documentVersion: text("document_version").notNull(),
    documentHash: text("document_hash"),
    acceptedAt: text("accepted_at").notNull(),
  },
  (table) => [
    uniqueIndex("account_agreement_version_idx")
      .on(table.accountId, table.documentKey, table.documentVersion, table.documentHash)
      .where(sql`is_deleted = 0`),
    index("account_agreement_current_idx").on(
      table.documentKey,
      table.documentVersion,
      table.documentHash,
      table.accountId,
    ),
  ],
);
