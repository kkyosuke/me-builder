import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  diagnoses,
  diagnosisQuestions,
  diagnosisScoringConfigs,
  questionChoices,
} from "../../../d1/shared/schema/catalog";
import { baseSchema } from "../../../table/base";
import { brainItems } from "./brain";
import { accountDataIdentity } from "./identity";
import { sourceRecords } from "./source";

export const diagnosisResponses = sqliteTable(
  "diagnosis_responses",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
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
      .references(() => accountDataIdentity.accountId),
    diagnosisId: text("diagnosis_id")
      .notNull()
      .references(() => diagnoses.id),
    scoringConfigId: text("scoring_config_id")
      .notNull()
      .references(() => diagnosisScoringConfigs.id),
    scoringConfigVersion: integer("scoring_config_version").notNull(),
    parameterId: text("parameter_id").notNull(),
    currentBrainItemId: text("current_brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    contentSignature: text("content_signature").notNull(),
  },
  (table) => [
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
