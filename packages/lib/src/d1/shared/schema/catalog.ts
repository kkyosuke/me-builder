import { sql } from "drizzle-orm";
import {
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { baseSchema, lifecycleSchema } from "../../../table/base";

/**
 * 全Accountが同じ内容を読む公開定義。
 *
 * AccountDataはこの定義をsnapshotとして保持するが、正本は共有D1にある。
 */
export const questions = sqliteTable("questions", {
  ...baseSchema,
});

export const questionVersions = sqliteTable(
  "question_versions",
  {
    ...lifecycleSchema,
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    version: integer("version").notNull(),
    state: text("state", { enum: ["draft", "approved", "retired"] }).notNull(),
    text: text("text").notNull(),
    hint: text("hint"),
    format: text("format", { enum: ["single_choice"] }).notNull(),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    retiredAt: integer("retired_at", { mode: "timestamp" }),
  },
  (table) => [
    primaryKey({ columns: [table.questionId, table.version] }),
    uniqueIndex("question_version_active_idx")
      .on(table.questionId, table.version)
      .where(sql`is_deleted = 0`),
  ],
);

export const questionChoices = sqliteTable(
  "question_choices",
  {
    ...lifecycleSchema,
    questionId: text("question_id").notNull(),
    questionVersion: integer("question_version").notNull(),
    choiceId: text("choice_id").notNull(),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    presentation: text("presentation", { mode: "json" }).$type<Record<string, string>>(),
  },
  (table) => [
    primaryKey({ columns: [table.questionId, table.questionVersion, table.choiceId] }),
    foreignKey({
      columns: [table.questionId, table.questionVersion],
      foreignColumns: [questionVersions.questionId, questionVersions.version],
    }),
    uniqueIndex("question_choice_position_idx").on(
      table.questionId,
      table.questionVersion,
      table.position,
    ),
  ],
);

/** 公開後も同じ診断結果を再現するための、不変な版付き採点設定。 */
export const diagnosisScoringConfigs = sqliteTable("diagnosis_scoring_configs", {
  ...baseSchema,
  version: integer("version").notNull(),
  definition: text("definition", { mode: "json" }).notNull().$type<unknown>(),
});

export const diagnoses = sqliteTable("diagnoses", {
  ...baseSchema,
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  scoringConfigId: text("scoring_config_id").references(() => diagnosisScoringConfigs.id),
  displayOrder: integer("display_order").notNull().default(0),
  opensAt: integer("opens_at", { mode: "timestamp" }).notNull(),
  closesAt: integer("closes_at", { mode: "timestamp" }),
  state: text("state", { enum: ["draft", "published", "withdrawn"] }).notNull(),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  withdrawnAt: integer("withdrawn_at", { mode: "timestamp" }),
});

export const diagnosisQuestions = sqliteTable(
  "diagnosis_questions",
  {
    ...baseSchema,
    diagnosisId: text("diagnosis_id")
      .notNull()
      .references(() => diagnoses.id),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    questionVersion: integer("question_version").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.questionId, table.questionVersion],
      foreignColumns: [questionVersions.questionId, questionVersions.version],
    }),
    uniqueIndex("diagnosis_question_active_idx")
      .on(table.diagnosisId, table.questionId)
      .where(sql`is_deleted = 0`),
    uniqueIndex("diagnosis_question_position_active_idx")
      .on(table.diagnosisId, table.position)
      .where(sql`is_deleted = 0`),
  ],
);

/** AccountDataが保持するsnapshotの同期要否を判定する版。 */
export const catalogVersions = sqliteTable("catalog_versions", {
  catalogId: text("catalog_id").primaryKey(),
  version: integer("version").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** 公開定義snapshotの単位。今は診断catalogだけを同期する。 */
export const DIAGNOSIS_CATALOG_ID = "diagnosis";
