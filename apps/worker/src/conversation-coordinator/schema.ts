import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const acceptedMessages = sqliteTable(
  "accepted_messages",
  {
    eventId: text("event_id").primaryKey(),
    accountId: text("account_id").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    receivedAt: integer("received_at").notNull(),
    status: text("status", { enum: ["pending", "attaching", "attached"] })
      .notNull()
      .default("pending"),
  },
  (table) => [index("accepted_message_status_received_idx").on(table.status, table.receivedAt)],
);

export const coordinatorState = sqliteTable("coordinator_state", {
  singleton: integer("singleton").primaryKey(),
  generationEpoch: integer("generation_epoch").notNull().default(0),
});

export const localTurns = sqliteTable("local_turns", {
  turnId: text("turn_id").primaryKey(),
  generationEpoch: integer("generation_epoch").notNull(),
  status: text("status", {
    enum: ["pending_queue", "queued", "generating", "delivered", "failed"],
  }).notNull(),
  leaseToken: text("lease_token"),
  hardDeadlineAt: integer("hard_deadline_at"),
});

export const coordinatorSchema = {
  acceptedMessages,
  coordinatorState,
  localTurns,
};
