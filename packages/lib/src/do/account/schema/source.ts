import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";
import { accountDataIdentity } from "./identity";

/** Source Record metadata. The immutable payload itself may live outside AccountData. */
export const sourceRecords = sqliteTable("source_records", {
  ...baseSchema,
  accountId: text("account_id")
    .notNull()
    .references(() => accountDataIdentity.accountId),
  kind: text("kind", { enum: ["user_input", "import"] }).notNull(),
  accessLabel: text("access_label").notNull().default("private"),
  originalRef: text("original_ref"),
});

/** Immutable revision edge between two Source Records. */
export const sourceRecordRevisions = sqliteTable(
  "source_record_revisions",
  {
    ...baseSchema,
    previousSourceRecordId: text("previous_source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    nextSourceRecordId: text("next_source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    derivationMethod: text("derivation_method", {
      enum: ["ai", "deterministic"],
    }).notNull(),
  },
  (table) => [
    uniqueIndex("source_record_revision_pair_idx").on(
      table.previousSourceRecordId,
      table.nextSourceRecordId,
    ),
  ],
);
