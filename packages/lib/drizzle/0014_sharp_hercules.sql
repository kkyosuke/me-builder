DROP TRIGGER IF EXISTS `chat_turn_response_account_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `chat_turn_response_account_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `conversation_message_turn_account_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `conversation_message_turn_account_update`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chat_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`session_id` text NOT NULL,
	`from_sequence` integer NOT NULL,
	`through_sequence` integer NOT NULL,
	`generation_epoch` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`prompt_version` text NOT NULL,
	`model` text NOT NULL,
	`end_session` integer DEFAULT false NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`failure_stage` text,
	`received_at` integer NOT NULL,
	`generation_started_at` integer,
	`first_reply_requested_at` integer,
	`final_reply_requested_at` integer,
	`response_message_id` text,
	`delivery_metric_token` text,
	FOREIGN KEY (`session_id`) REFERENCES `conversation_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_chat_turns`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "session_id", "from_sequence", "through_sequence", "generation_epoch", "status", "prompt_version", "model", "end_session", "attempt_count", "failure_stage", "received_at", "generation_started_at", "first_reply_requested_at", "final_reply_requested_at", "response_message_id", "delivery_metric_token") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "session_id", "from_sequence", "through_sequence", "generation_epoch", "status", "prompt_version", "model", "end_session", "attempt_count", "failure_stage", "received_at", "generation_started_at", "first_reply_requested_at", "final_reply_requested_at", "response_message_id", "delivery_metric_token" FROM `chat_turns`;--> statement-breakpoint
DROP TABLE `chat_turns`;--> statement-breakpoint
ALTER TABLE `__new_chat_turns` RENAME TO `chat_turns`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `chat_turn_status_created_idx` ON `chat_turns` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_turn_session_range_idx` ON `chat_turns` (`session_id`,`from_sequence`,`through_sequence`);--> statement-breakpoint
CREATE TABLE `__new_conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`source_record_id` text,
	`assistant_body` text,
	`channel` text NOT NULL,
	`channel_event_id` text,
	`turn_id` text,
	`sent_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `conversation_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversation_messages`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "session_id", "sequence", "role", "source_record_id", "assistant_body", "channel", "channel_event_id", "turn_id", "sent_at") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "session_id", "sequence", "role", "source_record_id", "assistant_body", "channel", "channel_event_id", "turn_id", "sent_at" FROM `conversation_messages`;--> statement-breakpoint
DROP TABLE `conversation_messages`;--> statement-breakpoint
ALTER TABLE `__new_conversation_messages` RENAME TO `conversation_messages`;--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_message_session_sequence_idx` ON `conversation_messages` (`session_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_message_channel_event_idx` ON `conversation_messages` (`channel`,`channel_event_id`) WHERE "conversation_messages"."channel_event_id" is not null;--> statement-breakpoint
CREATE TABLE `__new_source_record_text_payloads` (
	`source_record_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`content_type` text DEFAULT 'text/plain' NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_source_record_text_payloads`("source_record_id", "body", "content_type", "content_hash", "created_at") SELECT "source_record_id", "body", "content_type", "content_hash", "created_at" FROM `source_record_text_payloads`;--> statement-breakpoint
DROP TABLE `source_record_text_payloads`;--> statement-breakpoint
ALTER TABLE `__new_source_record_text_payloads` RENAME TO `source_record_text_payloads`;--> statement-breakpoint
CREATE TABLE `__new_diagnosis_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`diagnosis_response_id` text NOT NULL,
	`diagnosis_question_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_version` integer NOT NULL,
	`choice_id` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`source_record_id` text NOT NULL,
	FOREIGN KEY (`diagnosis_response_id`) REFERENCES `diagnosis_responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_question_id`) REFERENCES `diagnosis_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`,`question_version`,`choice_id`) REFERENCES `question_choices`(`question_id`,`question_version`,`choice_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_diagnosis_answers`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "diagnosis_question_id", "question_id", "question_version", "choice_id", "accepted_at", "source_record_id") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "diagnosis_question_id", "question_id", "question_version", "choice_id", "accepted_at", "source_record_id" FROM `diagnosis_answers`;--> statement-breakpoint
DROP TABLE `diagnosis_answers`;--> statement-breakpoint
ALTER TABLE `__new_diagnosis_answers` RENAME TO `diagnosis_answers`;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_answer_current_idx` ON `diagnosis_answers` (`diagnosis_response_id`,`diagnosis_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_answer_source_record_idx` ON `diagnosis_answers` (`source_record_id`);--> statement-breakpoint
CREATE TABLE `__new_diagnosis_brain_projection_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`diagnosis_response_id` text NOT NULL,
	`response_revision` integer NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`failure_code` text,
	FOREIGN KEY (`diagnosis_response_id`) REFERENCES `diagnosis_responses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_diagnosis_brain_projection_requests`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "response_revision", "status", "attempt_count", "next_attempt_at", "failure_code") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "response_revision", "status", "attempt_count", "next_attempt_at", "failure_code" FROM `diagnosis_brain_projection_requests`;--> statement-breakpoint
DROP TABLE `diagnosis_brain_projection_requests`;--> statement-breakpoint
ALTER TABLE `__new_diagnosis_brain_projection_requests` RENAME TO `diagnosis_brain_projection_requests`;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_brain_projection_revision_idx` ON `diagnosis_brain_projection_requests` (`diagnosis_response_id`,`response_revision`);--> statement-breakpoint
CREATE INDEX `diagnosis_brain_projection_pending_idx` ON `diagnosis_brain_projection_requests` (`status`,`next_attempt_at`) WHERE status IN ('pending', 'failed') AND is_deleted = 0;--> statement-breakpoint
CREATE TABLE `__new_diagnosis_deferred_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`diagnosis_response_id` text NOT NULL,
	`diagnosis_question_id` text NOT NULL,
	`deferred_at` integer NOT NULL,
	FOREIGN KEY (`diagnosis_response_id`) REFERENCES `diagnosis_responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_question_id`) REFERENCES `diagnosis_questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_diagnosis_deferred_questions`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "diagnosis_question_id", "deferred_at") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "diagnosis_question_id", "deferred_at" FROM `diagnosis_deferred_questions`;--> statement-breakpoint
DROP TABLE `diagnosis_deferred_questions`;--> statement-breakpoint
ALTER TABLE `__new_diagnosis_deferred_questions` RENAME TO `diagnosis_deferred_questions`;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_deferred_question_active_idx` ON `diagnosis_deferred_questions` (`diagnosis_response_id`,`diagnosis_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `__new_source_record_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`previous_source_record_id` text NOT NULL,
	`next_source_record_id` text NOT NULL,
	`derivation_method` text NOT NULL,
	FOREIGN KEY (`previous_source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`next_source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_source_record_revisions`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "previous_source_record_id", "next_source_record_id", "derivation_method") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "previous_source_record_id", "next_source_record_id", "derivation_method" FROM `source_record_revisions`;--> statement-breakpoint
DROP TABLE `source_record_revisions`;--> statement-breakpoint
ALTER TABLE `__new_source_record_revisions` RENAME TO `source_record_revisions`;--> statement-breakpoint
CREATE UNIQUE INDEX `source_record_revision_pair_idx` ON `source_record_revisions` (`previous_source_record_id`,`next_source_record_id`);--> statement-breakpoint
DROP INDEX `conversation_session_account_identity_idx`;--> statement-breakpoint
DROP INDEX `diagnosis_response_account_identity_idx`;
