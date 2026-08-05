import { sql } from "drizzle-orm";
import {
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { accounts } from "./account";
import { baseSchema, lifecycleSchema } from "./base";
import { sourceRecords } from "./source";

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

export const diagnoses = sqliteTable("diagnoses", {
  ...baseSchema,
  title: text("title").notNull(),
  // 既存D1へ列を追加した直後だけ空文字になり、diagnosis seedが正式な説明へ補完する。
  description: text("description").notNull().default(""),
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

export const diagnosisResponses = sqliteTable(
  "diagnosis_responses",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    diagnosisId: text("diagnosis_id")
      .notNull()
      .references(() => diagnoses.id),
  },
  (table) => [
    uniqueIndex("diagnosis_response_account_active_idx")
      .on(table.accountId, table.diagnosisId)
      .where(sql`is_deleted = 0`),
  ],
);

export const diagnosisAnswers = sqliteTable(
  "diagnosis_answers",
  {
    ...baseSchema,
    diagnosisResponseId: text("diagnosis_response_id")
      .notNull()
      .references(() => diagnosisResponses.id),
    diagnosisQuestionId: text("diagnosis_question_id")
      .notNull()
      .references(() => diagnosisQuestions.id),
    questionId: text("question_id").notNull(),
    questionVersion: integer("question_version").notNull(),
    choiceId: text("choice_id").notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }).notNull(),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
  },
  (table) => [
    foreignKey({
      columns: [table.questionId, table.questionVersion, table.choiceId],
      foreignColumns: [
        questionChoices.questionId,
        questionChoices.questionVersion,
        questionChoices.choiceId,
      ],
    }),
    uniqueIndex("diagnosis_answer_current_idx")
      .on(table.diagnosisResponseId, table.diagnosisQuestionId)
      .where(sql`is_deleted = 0`),
    uniqueIndex("diagnosis_answer_source_record_idx").on(table.sourceRecordId),
  ],
);

export const diagnosisDeferredQuestions = sqliteTable(
  "diagnosis_deferred_questions",
  {
    ...baseSchema,
    diagnosisResponseId: text("diagnosis_response_id")
      .notNull()
      .references(() => diagnosisResponses.id),
    diagnosisQuestionId: text("diagnosis_question_id")
      .notNull()
      .references(() => diagnosisQuestions.id),
    deferredAt: integer("deferred_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("diagnosis_deferred_question_active_idx")
      .on(table.diagnosisResponseId, table.diagnosisQuestionId)
      .where(sql`is_deleted = 0`),
  ],
);
