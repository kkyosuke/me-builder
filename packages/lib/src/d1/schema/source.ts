import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./account";
import { baseSchema } from "./base";

/** Source Record metadata. The immutable payload itself may live outside D1. */
export const sourceRecords = sqliteTable(
  "source_records",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    kind: text("kind", { enum: ["user_input", "import"] }).notNull(),
    accessLabel: text("access_label").notNull().default("private"),
    originalRef: text("original_ref"),
  },
  (table) => [
    uniqueIndex("source_record_account_original_ref_idx")
      .on(table.accountId, table.originalRef)
      .where(sql`${table.originalRef} is not null`),
  ],
);

/** D1に保存するテキスト原本。Source Recordと1対1で、本文はログへ出さない。 */
export const sourceRecordTextPayloads = sqliteTable("source_record_text_payloads", {
  sourceRecordId: text("source_record_id")
    .primaryKey()
    .references(() => sourceRecords.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  contentType: text("content_type").notNull().default("text/plain"),
  contentHash: text("content_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
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
