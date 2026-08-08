import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { accounts } from "./account";
import { baseSchema, lifecycleSchema } from "./base";
import { brainItems } from "./brain";
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

/** 公開後も同じ診断結果を再現するための、不変な版付き採点設定。 */
export const diagnosisScoringConfigs = sqliteTable("diagnosis_scoring_configs", {
  ...baseSchema,
  version: integer("version").notNull(),
  definition: text("definition", { mode: "json" }).notNull().$type<unknown>(),
});

export const diagnoses = sqliteTable("diagnoses", {
  ...baseSchema,
  title: text("title").notNull(),
  // 既存D1へ列を追加した直後だけ空文字になり、diagnosis seedが正式な説明へ補完する。
  description: text("description").notNull().default(""),
  scoringConfigId: text("scoring_config_id").references(() => diagnosisScoringConfigs.id),
  // 既存D1へ列を追加した直後だけ0になり、diagnosis seedが正式な表示順へ補完する。
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
    revision: integer("revision").notNull().default(0),
  },
  (table) => [
    uniqueIndex("diagnosis_response_account_active_idx")
      .on(table.accountId, table.diagnosisId)
      .where(sql`is_deleted = 0`),
  ],
);

/** Answer更新と同じatomic batchで登録するBrain Item projection要求。 */
export const diagnosisBrainProjectionRequests = sqliteTable(
  "diagnosis_brain_projection_requests",
  {
    ...baseSchema,
    diagnosisResponseId: text("diagnosis_response_id")
      .notNull()
      .references(() => diagnosisResponses.id, { onDelete: "cascade" }),
    responseRevision: integer("response_revision").notNull(),
    status: text("status", { enum: ["pending", "applied", "failed"] }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }).notNull(),
    failureCode: text("failure_code"),
  },
  (table) => [
    uniqueIndex("diagnosis_brain_projection_revision_idx").on(
      table.diagnosisResponseId,
      table.responseRevision,
    ),
    index("diagnosis_brain_projection_pending_idx")
      .on(table.status, table.nextAttemptAt)
      .where(sql`status IN ('pending', 'failed') AND is_deleted = 0`),
  ],
);

/** 診断パラメータprojectionの現在有効なBrain Itemを指すhead。 */
export const diagnosisBrainProjectionHeads = sqliteTable(
  "diagnosis_brain_projection_heads",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    diagnosisId: text("diagnosis_id")
      .notNull()
      .references(() => diagnoses.id),
    scoringConfigId: text("scoring_config_id")
      .notNull()
      .references(() => diagnosisScoringConfigs.id),
    scoringConfigVersion: integer("scoring_config_version").notNull(),
    parameterId: text("parameter_id").notNull(),
    currentBrainItemId: text("current_brain_item_id").notNull(),
    contentSignature: text("content_signature").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.currentBrainItemId, table.accountId],
      foreignColumns: [brainItems.id, brainItems.accountId],
      name: "diagnosis_brain_projection_head_item_account_fk",
    }),
    uniqueIndex("diagnosis_brain_projection_identity_idx").on(
      table.accountId,
      table.diagnosisId,
      table.scoringConfigId,
      table.scoringConfigVersion,
      table.parameterId,
    ),
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
