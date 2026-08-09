import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const avatarJobs = sqliteTable(
  "avatar_jobs",
  {
    id: text("id").primaryKey(),
    status: text("status", {
      enum: [
        "checking",
        "not_person",
        "verified",
        "accepted",
        "generating",
        "ready",
        "failed",
        "cancelled",
        "selected",
        "expired",
      ],
    }).notNull(),
    referenceObjectKey: text("reference_object_key").notNull(),
    referenceContentType: text("reference_content_type").notNull(),
    pendingOperation: text("pending_operation", { enum: ["person-check", "generate"] }),
    queuePending: integer("queue_pending", { mode: "boolean" }).notNull().default(true),
    nextEnqueueAt: integer("next_enqueue_at", { mode: "timestamp" }),
    processingLeaseExpiresAt: integer("processing_lease_expires_at", { mode: "timestamp" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    model: text("model"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("avatar_jobs_updated_at_idx").on(table.updatedAt),
    index("avatar_jobs_pending_queue_idx").on(table.queuePending, table.nextEnqueueAt),
    check("avatar_jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const avatarCandidates = sqliteTable(
  "avatar_candidates",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => avatarJobs.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    selectedAt: integer("selected_at", { mode: "timestamp" }),
  },
  (table) => [index("avatar_candidates_job_id_idx").on(table.jobId)],
);

export const avatarGenerationEvents = sqliteTable(
  "avatar_generation_events",
  {
    jobId: text("job_id")
      .primaryKey()
      .references(() => avatarJobs.id, { onDelete: "cascade" }),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("avatar_generation_events_started_at_idx").on(table.startedAt)],
);

export const avatarProfile = sqliteTable(
  "avatar_profile",
  {
    singleton: integer("singleton").primaryKey(),
    currentCandidateId: text("current_candidate_id").references(() => avatarCandidates.id, {
      onDelete: "set null",
    }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [check("avatar_profile_singleton_check", sql`${table.singleton} = 1`)],
);

/** R2削除をAccountDataのalarmから再試行するためのprivate outbox。 */
export const avatarObjectDeletions = sqliteTable(
  "avatar_object_deletions",
  {
    objectKey: text("object_key").primaryKey(),
    deleteAfter: integer("delete_after", { mode: "timestamp" }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    index("avatar_object_deletions_due_idx").on(table.deleteAfter),
    check("avatar_object_deletions_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ],
);
