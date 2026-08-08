import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./account";
import { baseSchema } from "./base";
import { sourceRecords } from "./source";

/** D1に保存するテキスト原本。既存のSource Record schema自体は変更しない。 */
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

export const conversationSessions = sqliteTable(
  "conversation_sessions",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    status: text("status", { enum: ["active", "closed"] })
      .notNull()
      .default("active"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    lastUserMessageAt: integer("last_user_message_at", { mode: "timestamp" }).notNull(),
    lastAssistantMessageAt: integer("last_assistant_message_at", { mode: "timestamp" }),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    closeReason: text("close_reason", { enum: ["explicit", "inactive", "hard_cap"] }),
    conversationPolicyId: text("conversation_policy_id").notNull().default("reflective"),
    replyOpportunityCount: integer("reply_opportunity_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    awaitingReply: integer("awaiting_reply", { mode: "boolean" }).notNull().default(false),
    nextSequence: integer("next_sequence").notNull().default(1),
  },
  (table) => [
    index("conversation_session_account_status_idx").on(table.accountId, table.status),
    uniqueIndex("conversation_session_active_account_idx")
      .on(table.accountId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const conversationMessages = sqliteTable(
  "conversation_messages",
  {
    ...baseSchema,
    sessionId: text("session_id")
      .notNull()
      .references(() => conversationSessions.id),
    sequence: integer("sequence").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    // TODO: 表示や集計でmessage種別が必要になった段階でkindを追加する。
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    /** チャット履歴の復元に使うため、Session終了後も保持する。 */
    assistantBody: text("assistant_body"),
    channel: text("channel").notNull(),
    channelEventId: text("channel_event_id"),
    turnId: text("turn_id"),
    sentAt: integer("sent_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("conversation_message_session_sequence_idx").on(table.sessionId, table.sequence),
    uniqueIndex("conversation_message_channel_event_idx")
      .on(table.channel, table.channelEventId)
      .where(sql`${table.channelEventId} is not null`),
  ],
);

export const chatTurns = sqliteTable(
  "chat_turns",
  {
    ...baseSchema,
    sessionId: text("session_id")
      .notNull()
      .references(() => conversationSessions.id),
    fromSequence: integer("from_sequence").notNull(),
    throughSequence: integer("through_sequence").notNull(),
    generationEpoch: integer("generation_epoch").notNull(),
    status: text("status", {
      enum: [
        "queued",
        "generating",
        "validated",
        "delivery_pending",
        "delivered",
        "delivery_unknown",
        "failed",
      ],
    })
      .notNull()
      .default("queued"),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    // TODO: 安全性経路の監視・監査要件を定義した段階でsafety_routeを追加する。
    endSession: integer("end_session", { mode: "boolean" }).notNull().default(false),
    attemptCount: integer("attempt_count").notNull().default(0),
    failureStage: text("failure_stage"),
    receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
    generationStartedAt: integer("generation_started_at", { mode: "timestamp" }),
    firstReplyRequestedAt: integer("first_reply_requested_at", { mode: "timestamp" }),
    finalReplyRequestedAt: integer("final_reply_requested_at", { mode: "timestamp" }),
    responseMessageId: text("response_message_id"),
    deliveryMetricToken: text("delivery_metric_token"),
  },
  (table) => [
    index("chat_turn_status_created_idx").on(table.status, table.createdAt),
    uniqueIndex("chat_turn_session_range_idx").on(
      table.sessionId,
      table.fromSequence,
      table.throughSequence,
    ),
  ],
);
