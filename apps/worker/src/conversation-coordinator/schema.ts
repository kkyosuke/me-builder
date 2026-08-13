import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const acceptedMessages = sqliteTable(
  "accepted_messages",
  {
    eventId: text("event_id").primaryKey(),
    accountId: text("account_id").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    receivedAt: integer("received_at").notNull(),
    traceId: text("trace_id"),
    status: text("status", { enum: ["pending", "attaching", "attached"] })
      .notNull()
      .default("pending"),
  },
  (table) => [index("accepted_message_status_received_idx").on(table.status, table.receivedAt)],
);

export const coordinatorState = sqliteTable(
  "coordinator_state",
  {
    singleton: integer("singleton").primaryKey(),
    generationEpoch: integer("generation_epoch").notNull().default(0),
    resetEpoch: integer("reset_epoch").notNull().default(0),
  },
  (table) => [check("coordinator_state_singleton_check", sql`${table.singleton} = 1`)],
);

export const coordinatorIdentity = sqliteTable(
  "coordinator_identity",
  {
    singleton: integer("singleton").primaryKey(),
    accountId: text("account_id").notNull().unique(),
  },
  (table) => [check("coordinator_identity_singleton_check", sql`${table.singleton} = 1`)],
);

export const attachBatches = sqliteTable("attach_batches", {
  id: text("id").primaryKey(),
  generationEpoch: integer("generation_epoch").notNull(),
});

export const attachBatchMessages = sqliteTable(
  "attach_batch_messages",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => acceptedMessages.eventId, { onDelete: "cascade" }),
    batchId: text("batch_id")
      .notNull()
      .references(() => attachBatches.id, { onDelete: "cascade" }),
  },
  (table) => [index("attach_batch_message_batch_idx").on(table.batchId)],
);

export const localTurns = sqliteTable("local_turns", {
  turnId: text("turn_id").primaryKey(),
  generationEpoch: integer("generation_epoch").notNull(),
  traceIds: text("trace_ids", { mode: "json" }).$type<string[]>(),
  status: text("status", {
    enum: ["pending_queue", "queued", "generating", "delivered", "failed"],
  }).notNull(),
  leaseToken: text("lease_token"),
  hardDeadlineAt: integer("hard_deadline_at"),
});

export const deliveryOutbox = sqliteTable(
  "delivery_outbox",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["final", "failure"] }).notNull(),
    turnId: text("turn_id"),
    generationEpoch: integer("generation_epoch"),
    target: text("target").notNull(),
    body: text("body").notNull(),
    retryKey: text("retry_key").notNull(),
    status: text("status", {
      enum: ["pending", "delivered", "permanent_failure", "delivery_unknown"],
    })
      .notNull()
      .default("pending"),
    deadlineAt: integer("deadline_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("delivery_outbox_status_deadline_idx").on(table.status, table.deadlineAt),
    index("delivery_outbox_turn_idx").on(table.turnId, table.generationEpoch),
  ],
);

export const coordinatorSchema = {
  acceptedMessages,
  attachBatches,
  attachBatchMessages,
  coordinatorIdentity,
  coordinatorState,
  deliveryOutbox,
  localTurns,
};
