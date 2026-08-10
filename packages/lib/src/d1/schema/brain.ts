import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { accounts } from "./account";
import { baseSchema } from "./base";
import { sourceRecords } from "./source";

/** Source Recordから導出されたBrainの命題。 */
export const brainItems = sqliteTable(
  "brain_items",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    category: text("category").notNull(),
    statement: text("statement").notNull(),
    attributes: text("attributes_json", { mode: "json" }).notNull().$type<unknown>(),
    derivation: text("derivation", { enum: ["ai", "deterministic"] }).notNull(),
    status: text("status", { enum: ["active", "superseded", "invalidated"] }).notNull(),
    validFrom: integer("valid_from", { mode: "timestamp" }),
    validTo: integer("valid_to", { mode: "timestamp" }),
    stability: text("stability", { enum: ["temporary", "changeable", "stable"] }).notNull(),
    sensitivity: text("sensitivity").notNull(),
    externallyShareable: integer("externally_shareable", { mode: "boolean" })
      .notNull()
      .default(false),
    confidence: text("confidence_json", { mode: "json" }).notNull().$type<unknown>(),
  },
  (table) => [
    index("brain_item_lookup_idx").on(table.accountId, table.status, table.category),
    // EvidenceとRevisionがItemの所有Accountを含む複合FKで参照する。
    uniqueIndex("brain_item_id_account_idx").on(table.id, table.accountId),
  ],
);

/** AccountDataを正としてVectorizeへの反映を再試行するoutbox。本文は保持しない。 */
export const brainVectorSyncJobs = sqliteTable(
  "brain_vector_sync_jobs",
  {
    ...baseSchema,
    accountId: text("account_id").notNull(),
    brainItemId: text("brain_item_id").notNull(),
    itemRevision: integer("item_revision").notNull(),
    operation: text("operation", { enum: ["upsert", "delete"] }).notNull(),
    status: text("status", {
      enum: ["pending", "submitted", "applied", "failed"],
    }).notNull(),
    mutationId: text("mutation_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }).notNull(),
    failureCode: text("failure_code"),
  },
  (table) => [
    uniqueIndex("brain_vector_sync_job_revision_idx").on(
      table.brainItemId,
      table.itemRevision,
      table.operation,
    ),
    index("brain_vector_sync_job_due_idx").on(table.accountId, table.status, table.nextAttemptAt),
  ],
);

/** Vectorizeの仮名IDをAccountData上のBrain Itemへ戻す対応表。 */
export const brainVectorEntries = sqliteTable(
  "brain_vector_entries",
  {
    ...baseSchema,
    accountId: text("account_id").notNull(),
    brainItemId: text("brain_item_id").notNull(),
    itemRevision: integer("item_revision").notNull(),
  },
  (table) => [uniqueIndex("brain_vector_entry_item_idx").on(table.accountId, table.brainItemId)],
);

/** Source RecordがBrain Itemを支える、または反証する関係。 */
export const brainItemEvidenceEdges = sqliteTable(
  "brain_item_evidence_edges",
  {
    ...baseSchema,
    accountId: text("account_id").notNull(),
    brainItemId: text("brain_item_id").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    relation: text("relation", { enum: ["supports", "contradicts"] }).notNull(),
    isDerivationTrigger: integer("is_derivation_trigger", { mode: "boolean" }).notNull(),
    derivationMethod: text("derivation_method", {
      enum: ["ai", "deterministic"],
    }).notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.brainItemId, table.accountId],
      foreignColumns: [brainItems.id, brainItems.accountId],
      name: "brain_item_evidence_item_account_fk",
    }),
    foreignKey({
      columns: [table.sourceRecordId, table.accountId],
      foreignColumns: [sourceRecords.id, sourceRecords.accountId],
      name: "brain_item_evidence_source_account_fk",
    }),
    uniqueIndex("brain_item_evidence_relation_idx").on(
      table.brainItemId,
      table.sourceRecordId,
      table.relation,
    ),
  ],
);

/** 内容変更によって置き換えられたBrain Item間の改訂関係。 */
export const brainItemRevisions = sqliteTable(
  "brain_item_revisions",
  {
    ...baseSchema,
    accountId: text("account_id").notNull(),
    previousBrainItemId: text("previous_brain_item_id").notNull(),
    nextBrainItemId: text("next_brain_item_id").notNull(),
    derivationMethod: text("derivation_method", {
      enum: ["ai", "deterministic"],
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.previousBrainItemId, table.accountId],
      foreignColumns: [brainItems.id, brainItems.accountId],
      name: "brain_item_revision_previous_account_fk",
    }),
    foreignKey({
      columns: [table.nextBrainItemId, table.accountId],
      foreignColumns: [brainItems.id, brainItems.accountId],
      name: "brain_item_revision_next_account_fk",
    }),
    uniqueIndex("brain_item_revision_pair_idx").on(
      table.previousBrainItemId,
      table.nextBrainItemId,
    ),
  ],
);

/** Brain Itemを利用できる用途。1つのItemへ複数付与できる。 */
export const brainItemAccessLabels = sqliteTable(
  "brain_item_access_labels",
  {
    ...baseSchema,
    accountId: text("account_id").notNull(),
    brainItemId: text("brain_item_id").notNull(),
    label: text("label").notNull(),
    assignedBy: text("assigned_by", { enum: ["system", "owner"] }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.brainItemId, table.accountId],
      foreignColumns: [brainItems.id, brainItems.accountId],
      name: "brain_item_access_label_item_account_fk",
    }),
    uniqueIndex("brain_item_access_label_active_idx")
      .on(table.brainItemId, table.label)
      .where(sql`is_deleted = 0`),
    index("brain_item_access_label_lookup_idx").on(table.accountId, table.label, table.isDeleted),
  ],
);

/** 認可には使用せず、Brain Itemの検索と整理に使うTopic Label。 */
export const brainItemTopicLabels = sqliteTable(
  "brain_item_topic_labels",
  {
    ...baseSchema,
    accountId: text("account_id").notNull(),
    brainItemId: text("brain_item_id").notNull(),
    label: text("label").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.brainItemId, table.accountId],
      foreignColumns: [brainItems.id, brainItems.accountId],
      name: "brain_item_topic_label_item_account_fk",
    }),
    uniqueIndex("brain_item_topic_label_active_idx")
      .on(table.brainItemId, table.label)
      .where(sql`is_deleted = 0`),
    index("brain_item_topic_label_lookup_idx").on(table.accountId, table.label, table.isDeleted),
  ],
);
