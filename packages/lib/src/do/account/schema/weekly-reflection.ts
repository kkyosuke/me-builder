import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { MonthlyChangeContent, WeeklyReflectionContent } from "../../../weekly-reflection";
import { accountDataIdentity } from "./identity";

export const weeklyReflectionGenerations = sqliteTable(
  "weekly_reflection_generations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    weekStart: text("week_start").notNull(),
    status: text("status", { enum: ["queued", "generating", "completed", "failed"] }).notNull(),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    dispatchedAt: integer("dispatched_at", { mode: "timestamp_ms" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    failureMessage: text("failure_message"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    notificationStatus: text("notification_status", {
      enum: ["pending", "skipped", "not-applicable"],
    })
      .notNull()
      .default("not-applicable"),
  },
  (table) => [
    uniqueIndex("weekly_reflection_generation_account_week_idx").on(
      table.accountId,
      table.weekStart,
    ),
    index("weekly_reflection_generation_dispatch_idx").on(table.status, table.dispatchedAt),
  ],
);

export const weeklyReflections = sqliteTable(
  "weekly_reflections",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .unique()
      .references(() => weeklyReflectionGenerations.id),
    weekStart: text("week_start").notNull().unique(),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
    content: text("content_json", { mode: "json" }).notNull().$type<WeeklyReflectionContent>(),
  },
  (table) => [index("weekly_reflection_generated_idx").on(table.generatedAt)],
);

export const monthlyChangeVersions = sqliteTable(
  "monthly_change_versions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    month: text("month").notNull(),
    version: integer("version").notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
    content: text("content_json", { mode: "json" }).notNull().$type<MonthlyChangeContent>(),
  },
  (table) => [
    uniqueIndex("monthly_change_account_month_version_idx").on(
      table.accountId,
      table.month,
      table.version,
    ),
    index("monthly_change_generated_idx").on(table.accountId, table.generatedAt),
  ],
);
