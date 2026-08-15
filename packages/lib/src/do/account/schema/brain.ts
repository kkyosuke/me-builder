import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";
import { accountDataIdentity } from "./identity";
import { sourceRecords } from "./source";

/** Source Recordから導出されたBrainの命題。 */
export const brainItems = sqliteTable(
  "brain_items",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
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
  (table) => [index("brain_item_lookup_idx").on(table.accountId, table.status, table.category)],
);

/** AccountDataを正としてVectorizeへの反映を再試行するoutbox。本文は保持しない。 */
export const brainVectorSyncJobs = sqliteTable(
  "brain_vector_sync_jobs",
  {
    ...baseSchema,
    brainItemId: text("brain_item_id").notNull(),
    itemRevision: integer("item_revision").notNull(),
    operation: text("operation", { enum: ["upsert", "delete"] }).notNull(),
    status: text("status", {
      enum: ["pending", "submitted", "retry_scheduled", "applied", "failed"],
    }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }).notNull(),
    mutationId: text("mutation_id"),
    failureCode: text("failure_code"),
  },
  (table) => [
    uniqueIndex("brain_vector_sync_job_revision_idx").on(
      table.brainItemId,
      table.itemRevision,
      table.operation,
    ),
    index("brain_vector_sync_job_due_idx").on(table.status, table.nextAttemptAt),
  ],
);

/** Vectorizeの仮名IDをAccountData上のBrain Itemへ戻す対応表。 */
export const brainVectorEntries = sqliteTable(
  "brain_vector_entries",
  {
    ...baseSchema,
    brainItemId: text("brain_item_id").notNull(),
    itemRevision: integer("item_revision").notNull(),
  },
  (table) => [uniqueIndex("brain_vector_entry_item_idx").on(table.brainItemId)],
);

/**
 * Source RecordがBrain Itemを支える、または反証する関係。
 *
 * 所有Accountは`brain_items`から一意に決まるため`account_id`を重複保存しない。
 */
export const brainItemEvidenceEdges = sqliteTable(
  "brain_item_evidence_edges",
  {
    ...baseSchema,
    brainItemId: text("brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => sourceRecords.id),
    relation: text("relation", { enum: ["supports", "contradicts"] }).notNull(),
    isDerivationTrigger: integer("is_derivation_trigger", { mode: "boolean" }).notNull(),
    derivationMethod: text("derivation_method", {
      enum: ["ai", "deterministic"],
    }).notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("brain_item_evidence_relation_idx").on(
      table.brainItemId,
      table.sourceRecordId,
      table.relation,
    ),
    index("brain_item_evidence_item_idx").on(table.brainItemId, table.isDeleted),
  ],
);

/** 内容変更によって置き換えられたBrain Item間の改訂関係。 */
export const brainItemRevisions = sqliteTable(
  "brain_item_revisions",
  {
    ...baseSchema,
    previousBrainItemId: text("previous_brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    nextBrainItemId: text("next_brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    derivationMethod: text("derivation_method", {
      enum: ["ai", "deterministic"],
    }).notNull(),
    changeKind: text("change_kind", { enum: ["correction", "temporal"] })
      .notNull()
      .default("correction"),
  },
  (table) => [
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
    brainItemId: text("brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    label: text("label").notNull(),
    assignedBy: text("assigned_by", { enum: ["system", "owner"] }).notNull(),
  },
  (table) => [
    uniqueIndex("brain_item_access_label_active_idx")
      .on(table.brainItemId, table.label)
      .where(sql`is_deleted = 0`),
    index("brain_item_access_label_lookup_idx").on(table.label, table.isDeleted),
  ],
);

/** 認可には使用せず、Brain Itemの検索と整理に使うTopic Label。 */
export const brainItemTopicLabels = sqliteTable(
  "brain_item_topic_labels",
  {
    ...baseSchema,
    brainItemId: text("brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    label: text("label").notNull(),
  },
  (table) => [
    uniqueIndex("brain_item_topic_label_active_idx")
      .on(table.brainItemId, table.label)
      .where(sql`is_deleted = 0`),
    index("brain_item_topic_label_lookup_idx").on(table.label, table.isDeleted),
  ],
);
