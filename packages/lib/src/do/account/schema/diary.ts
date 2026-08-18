import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";
import type { DailyPromptLocalHour } from "../prompt-context";
import { brainItems } from "./brain";
import { accountDataIdentity } from "./identity";
import { sourceRecords } from "./source";

/** AccountDataに保存するテキスト原本。 */
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
      .references(() => accountDataIdentity.accountId),
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

/** 日次声かけの状態と、その状態を決めた最新の本人発言を保持する。 */
export const dailyPromptPreferences = sqliteTable("daily_prompt_preferences", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accountDataIdentity.accountId),
  status: text("status", { enum: ["active", "stopped"] }).notNull(),
  controlledAt: integer("controlled_at", { mode: "timestamp_ms" }).notNull(),
  controlSourceRecordId: text("control_source_record_id")
    .notNull()
    .references(() => sourceRecords.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** 同じ日本日付の候補処理で再選択しないよう、時刻と選択元を1回だけ固定する。 */
export const dailyPromptSchedules = sqliteTable(
  "daily_prompt_schedules",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    localDate: text("local_date").notNull(),
    selectedLocalHour: integer("selected_local_hour").$type<DailyPromptLocalHour>().notNull(),
    selectionSource: text("selection_source", {
      enum: ["explicit", "learned", "fallback"],
    }).notNull(),
  },
  (table) => [
    uniqueIndex("daily_prompt_schedule_account_date_idx").on(table.accountId, table.localDate),
  ],
);

/** 日本時間の日付ごとに、固定声かけの送信可否とLINE配送結果を保持する。 */
export const dailyPromptDeliveries = sqliteTable(
  "daily_prompt_deliveries",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    localDate: text("local_date").notNull(),
    promptVersion: text("prompt_version").notNull(),
    promptStrategy: text("prompt_strategy", {
      enum: ["standard", "brief", "event_first", "feeling_first"],
    })
      .notNull()
      .default("standard"),
    promptStrategySource: text("prompt_strategy_source", {
      enum: ["explicit", "learned", "fallback"],
    }),
    deliveryLocalHour: integer("delivery_local_hour")
      .$type<DailyPromptLocalHour>()
      .notNull()
      .default(18),
    status: text("status", { enum: ["pending", "delivered", "skipped", "failed"] })
      .notNull()
      .default("pending"),
    skipReason: text("skip_reason", {
      enum: [
        "manual_stopped",
        "stale",
        "active_session",
        "user_activity",
        "recent_unanswered",
        "auto_paused",
      ],
    }),
    failureStage: text("failure_stage"),
    deliveredAt: integer("delivered_at", { mode: "timestamp" }),
    respondedAt: integer("responded_at", { mode: "timestamp" }),
    responseKind: text("response_kind", { enum: ["reply", "stop"] }),
  },
  (table) => [
    uniqueIndex("daily_prompt_delivery_account_date_idx").on(table.accountId, table.localDate),
    index("daily_prompt_delivery_account_status_idx").on(
      table.accountId,
      table.status,
      table.localDate,
    ),
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
    safetyRoute: text("safety_route", {
      enum: [
        "normal",
        "distress",
        "high_stakes",
        "abuse_or_violence",
        "self_harm_possible",
        "imminent_danger",
      ],
    }),
    endSession: integer("end_session", { mode: "boolean" }).notNull().default(false),
    /** 終了後の日次声かけで使える、本文を含まない継続区分。 */
    dailyPromptFollowUp: text("daily_prompt_follow_up", { enum: ["same_day", "next_day"] }),
    /** 自然な確認質問を出した場合だけ、収集テーマと対象属性を対で保持する。 */
    collectionThemeId: text("collection_theme_id"),
    collectionKind: text("collection_kind"),
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

/** 日記チャットが回答生成に実際に利用したBrain Itemと根拠の監査snapshot。 */
export const diaryChatBrainUsageAudits = sqliteTable(
  "diary_chat_brain_usage_audits",
  {
    ...baseSchema,
    turnId: text("turn_id")
      .notNull()
      .references(() => chatTurns.id),
    brainItemId: text("brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    purpose: text("purpose", { enum: ["diary_chat"] }).notNull(),
    status: text("status", { enum: ["active", "superseded", "invalidated"] }).notNull(),
    derivation: text("derivation", { enum: ["ai", "deterministic"] }).notNull(),
    confidence: text("confidence_json", { mode: "json" }).notNull().$type<unknown>(),
    accessLabels: text("access_labels_json", { mode: "json" }).notNull().$type<readonly string[]>(),
    sourceRecordIds: text("source_record_ids_json", { mode: "json" })
      .notNull()
      .$type<readonly string[]>(),
  },
  (table) => [
    uniqueIndex("diary_chat_brain_usage_turn_item_idx").on(
      table.turnId,
      table.brainItemId,
      table.purpose,
    ),
    index("diary_chat_brain_usage_turn_idx").on(table.turnId),
  ],
);

/** 複数Turnをまとめ、無操作または最大待機時間でBrain Itemへ変換する範囲。 */
export const diaryBrainCheckpoints = sqliteTable(
  "diary_brain_checkpoints",
  {
    ...baseSchema,
    sessionId: text("session_id")
      .notNull()
      .references(() => conversationSessions.id),
    fromSequence: integer("from_sequence").notNull(),
    throughSequence: integer("through_sequence").notNull(),
    firstMessageAt: integer("first_message_at", { mode: "timestamp" }).notNull(),
    lastMessageAt: integer("last_message_at", { mode: "timestamp" }).notNull(),
    dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }).notNull(),
    status: text("status", { enum: ["pending", "queued", "dispatched", "applied", "failed"] })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    appliedAt: integer("applied_at", { mode: "timestamp" }),
    developmentNotificationSentAt: integer("development_notification_sent_at", {
      mode: "timestamp",
    }),
  },
  (table) => [
    uniqueIndex("diary_brain_checkpoint_pending_session_idx")
      .on(table.sessionId)
      .where(sql`${table.status} = 'pending' AND ${table.isDeleted} = 0`),
    index("diary_brain_checkpoint_due_idx").on(table.status, table.nextAttemptAt, table.isDeleted),
  ],
);

/** checkpointから作成またはEvidence追加したBrain Item。dev通知と監査で保存結果を再取得する。 */
export const diaryBrainCheckpointItems = sqliteTable(
  "diary_brain_checkpoint_items",
  {
    ...baseSchema,
    checkpointId: text("checkpoint_id")
      .notNull()
      .references(() => diaryBrainCheckpoints.id),
    brainItemId: text("brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    position: integer("position").notNull(),
    operation: text("operation", { enum: ["created", "evidence_added"] })
      .notNull()
      .default("created"),
    deduplication: text("deduplication", { enum: ["none", "exact", "semantic"] })
      .notNull()
      .default("none"),
    dedupPromptVersion: text("dedup_prompt_version"),
  },
  (table) => [
    uniqueIndex("diary_brain_checkpoint_item_position_idx").on(table.checkpointId, table.position),
    uniqueIndex("diary_brain_checkpoint_item_brain_idx").on(table.checkpointId, table.brainItemId),
  ],
);
