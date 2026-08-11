import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ProfileSummaryContent } from "../../../profile-summary";
import { accountDataIdentity } from "./identity";

/** 非同期生成の状態を保存し、同じAccountの処理中要求を1件に制限する。 */
export const profileSummaryGenerations = sqliteTable(
  "profile_summary_generations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    status: text("status", { enum: ["queued", "generating", "completed", "failed"] }).notNull(),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    failureMessage: text("failure_message"),
    model: text("model"),
    promptVersion: text("prompt_version"),
  },
  (table) => [
    uniqueIndex("profile_summary_generation_active_account_idx")
      .on(table.accountId)
      .where(sql`${table.status} in ('queued', 'generating')`),
    index("profile_summary_generation_account_requested_idx").on(
      table.accountId,
      table.requestedAt,
    ),
  ],
);

/** AI生成済みの本文をAccount内の不変版として追記する。 */
export const profileSummaryVersions = sqliteTable(
  "profile_summary_versions",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .unique()
      .references(() => profileSummaryGenerations.id),
    sequence: integer("sequence").notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    diagnosisInputCount: integer("diagnosis_input_count").notNull(),
    diagnosisInputLatestAt: integer("diagnosis_input_latest_at", { mode: "timestamp_ms" }),
    diaryInputCount: integer("diary_input_count").notNull(),
    diaryInputLatestAt: integer("diary_input_latest_at", { mode: "timestamp_ms" }),
    summary: text("summary_json", { mode: "json" }).notNull().$type<ProfileSummaryContent>(),
  },
  (table) => [
    uniqueIndex("profile_summary_version_sequence_idx").on(table.sequence),
    index("profile_summary_version_generated_idx").on(table.generatedAt),
  ],
);
