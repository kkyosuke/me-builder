import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";
import { accountDataIdentity } from "./identity";
import { sourceRecords } from "./source";

/** LINE写真日記のprivate R2参照。画像bytesやEXIFはAccountDataへ複製しない。 */
export const photoDiaryMedia = sqliteTable(
  "photo_diary_media",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => sourceRecords.id),
    webhookEventId: text("webhook_event_id").notNull(),
    lineMessageId: text("line_message_id").notNull(),
    originalObjectKey: text("original_object_key").notNull(),
    thumbnailObjectKey: text("thumbnail_object_key").notNull(),
    mimeType: text("mime_type", { enum: ["image/jpeg", "image/png", "image/webp"] }).notNull(),
    byteSize: integer("byte_size").notNull(),
    thumbnailByteSize: integer("thumbnail_byte_size").notNull(),
    storageByteSize: integer("storage_byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
    storageStatus: text("storage_status", {
      enum: ["reserved", "available", "deleting", "deleted"],
    })
      .notNull()
      .default("reserved"),
    usageEligibility: text("usage_eligibility", {
      enum: ["unreviewed", "allowed", "blocked"],
    })
      .notNull()
      .default("unreviewed"),
    reservedAt: integer("reserved_at", { mode: "timestamp_ms" }).notNull(),
    storedAt: integer("stored_at", { mode: "timestamp_ms" }),
    deleteDueAt: integer("delete_due_at", { mode: "timestamp_ms" }),
    deletionEnqueuedAt: integer("deletion_enqueued_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("photo_diary_media_account_message_idx").on(table.accountId, table.lineMessageId),
    uniqueIndex("photo_diary_media_account_webhook_idx").on(table.accountId, table.webhookEventId),
    index("photo_diary_media_account_status_idx").on(
      table.accountId,
      table.storageStatus,
      table.capturedAt,
    ),
  ],
);
