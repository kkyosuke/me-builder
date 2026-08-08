PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__account_boundary_guard` (`valid` integer NOT NULL CHECK (`valid` = 1));--> statement-breakpoint
INSERT INTO `__account_boundary_guard` (`valid`) SELECT 0 FROM `conversation_messages` messages INNER JOIN `conversation_sessions` sessions ON sessions.`id` = messages.`session_id` INNER JOIN `source_records` sources ON sources.`id` = messages.`source_record_id` WHERE sessions.`account_id` <> sources.`account_id` LIMIT 1;--> statement-breakpoint
INSERT INTO `__account_boundary_guard` (`valid`) SELECT 0 FROM `chat_turns` turns INNER JOIN `conversation_sessions` turn_sessions ON turn_sessions.`id` = turns.`session_id` LEFT JOIN `conversation_messages` messages ON messages.`id` = turns.`response_message_id` LEFT JOIN `conversation_sessions` message_sessions ON message_sessions.`id` = messages.`session_id` WHERE turns.`response_message_id` IS NOT NULL AND (messages.`id` IS NULL OR turn_sessions.`account_id` <> message_sessions.`account_id`) LIMIT 1;--> statement-breakpoint
INSERT INTO `__account_boundary_guard` (`valid`) SELECT 0 FROM `conversation_messages` messages INNER JOIN `conversation_sessions` message_sessions ON message_sessions.`id` = messages.`session_id` LEFT JOIN `chat_turns` turns ON turns.`id` = messages.`turn_id` LEFT JOIN `conversation_sessions` turn_sessions ON turn_sessions.`id` = turns.`session_id` WHERE messages.`turn_id` IS NOT NULL AND (turns.`id` IS NULL OR message_sessions.`account_id` <> turn_sessions.`account_id`) LIMIT 1;--> statement-breakpoint
INSERT INTO `__account_boundary_guard` (`valid`) SELECT 0 FROM `diagnosis_answers` answers INNER JOIN `diagnosis_responses` responses ON responses.`id` = answers.`diagnosis_response_id` INNER JOIN `source_records` sources ON sources.`id` = answers.`source_record_id` WHERE responses.`account_id` <> sources.`account_id` LIMIT 1;--> statement-breakpoint
INSERT INTO `__account_boundary_guard` (`valid`) SELECT 0 FROM `source_record_revisions` revisions INNER JOIN `source_records` previous_sources ON previous_sources.`id` = revisions.`previous_source_record_id` INNER JOIN `source_records` next_sources ON next_sources.`id` = revisions.`next_source_record_id` WHERE previous_sources.`account_id` <> next_sources.`account_id` LIMIT 1;--> statement-breakpoint
DROP TABLE `__account_boundary_guard`;--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_session_account_identity_idx` ON `conversation_sessions` (`id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_response_account_identity_idx` ON `diagnosis_responses` (`id`,`account_id`);--> statement-breakpoint
CREATE TABLE `__new_chat_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
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
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`account_id`) REFERENCES `conversation_sessions`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_chat_turns`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "account_id", "session_id", "from_sequence", "through_sequence", "generation_epoch", "status", "prompt_version", "model", "end_session", "attempt_count", "failure_stage", "received_at", "generation_started_at", "first_reply_requested_at", "final_reply_requested_at", "response_message_id", "delivery_metric_token") SELECT turns."id", turns."created_at", turns."updated_at", turns."deleted_at", turns."is_deleted", sessions."account_id", turns."session_id", turns."from_sequence", turns."through_sequence", turns."generation_epoch", turns."status", turns."prompt_version", turns."model", turns."end_session", turns."attempt_count", turns."failure_stage", turns."received_at", turns."generation_started_at", turns."first_reply_requested_at", turns."final_reply_requested_at", turns."response_message_id", turns."delivery_metric_token" FROM `chat_turns` turns INNER JOIN `conversation_sessions` sessions ON sessions."id" = turns."session_id";--> statement-breakpoint
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
	`account_id` text NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`source_record_id` text,
	`assistant_body` text,
	`channel` text NOT NULL,
	`channel_event_id` text,
	`turn_id` text,
	`sent_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`account_id`) REFERENCES `conversation_sessions`(`id`,`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`,`account_id`) REFERENCES `source_records`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversation_messages`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "account_id", "session_id", "sequence", "role", "source_record_id", "assistant_body", "channel", "channel_event_id", "turn_id", "sent_at") SELECT messages."id", messages."created_at", messages."updated_at", messages."deleted_at", messages."is_deleted", sessions."account_id", messages."session_id", messages."sequence", messages."role", messages."source_record_id", messages."assistant_body", messages."channel", messages."channel_event_id", messages."turn_id", messages."sent_at" FROM `conversation_messages` messages INNER JOIN `conversation_sessions` sessions ON sessions."id" = messages."session_id";--> statement-breakpoint
DROP TABLE `conversation_messages`;--> statement-breakpoint
ALTER TABLE `__new_conversation_messages` RENAME TO `conversation_messages`;--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_message_account_identity_idx` ON `conversation_messages` (`id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_message_session_sequence_idx` ON `conversation_messages` (`session_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_message_channel_event_idx` ON `conversation_messages` (`channel`,`channel_event_id`) WHERE "conversation_messages"."channel_event_id" is not null;--> statement-breakpoint
CREATE TABLE `__new_source_record_text_payloads` (
	`source_record_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`body` text NOT NULL,
	`content_type` text DEFAULT 'text/plain' NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`,`account_id`) REFERENCES `source_records`(`id`,`account_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_source_record_text_payloads`("source_record_id", "account_id", "body", "content_type", "content_hash", "created_at") SELECT payloads."source_record_id", sources."account_id", payloads."body", payloads."content_type", payloads."content_hash", payloads."created_at" FROM `source_record_text_payloads` payloads INNER JOIN `source_records` sources ON sources."id" = payloads."source_record_id";--> statement-breakpoint
DROP TABLE `source_record_text_payloads`;--> statement-breakpoint
ALTER TABLE `__new_source_record_text_payloads` RENAME TO `source_record_text_payloads`;--> statement-breakpoint
CREATE TABLE `__new_diagnosis_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`diagnosis_response_id` text NOT NULL,
	`diagnosis_question_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_version` integer NOT NULL,
	`choice_id` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`source_record_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_question_id`) REFERENCES `diagnosis_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_response_id`,`account_id`) REFERENCES `diagnosis_responses`(`id`,`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`,`account_id`) REFERENCES `source_records`(`id`,`account_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`,`question_version`,`choice_id`) REFERENCES `question_choices`(`question_id`,`question_version`,`choice_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_diagnosis_answers`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "account_id", "diagnosis_response_id", "diagnosis_question_id", "question_id", "question_version", "choice_id", "accepted_at", "source_record_id") SELECT answers."id", answers."created_at", answers."updated_at", answers."deleted_at", answers."is_deleted", responses."account_id", answers."diagnosis_response_id", answers."diagnosis_question_id", answers."question_id", answers."question_version", answers."choice_id", answers."accepted_at", answers."source_record_id" FROM `diagnosis_answers` answers INNER JOIN `diagnosis_responses` responses ON responses."id" = answers."diagnosis_response_id";--> statement-breakpoint
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
	`account_id` text NOT NULL,
	`diagnosis_response_id` text NOT NULL,
	`response_revision` integer NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`failure_code` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_response_id`,`account_id`) REFERENCES `diagnosis_responses`(`id`,`account_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_diagnosis_brain_projection_requests`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "account_id", "diagnosis_response_id", "response_revision", "status", "attempt_count", "next_attempt_at", "failure_code") SELECT requests."id", requests."created_at", requests."updated_at", requests."deleted_at", requests."is_deleted", responses."account_id", requests."diagnosis_response_id", requests."response_revision", requests."status", requests."attempt_count", requests."next_attempt_at", requests."failure_code" FROM `diagnosis_brain_projection_requests` requests INNER JOIN `diagnosis_responses` responses ON responses."id" = requests."diagnosis_response_id";--> statement-breakpoint
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
	`account_id` text NOT NULL,
	`diagnosis_response_id` text NOT NULL,
	`diagnosis_question_id` text NOT NULL,
	`deferred_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_question_id`) REFERENCES `diagnosis_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_response_id`,`account_id`) REFERENCES `diagnosis_responses`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_diagnosis_deferred_questions`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "account_id", "diagnosis_response_id", "diagnosis_question_id", "deferred_at") SELECT deferred."id", deferred."created_at", deferred."updated_at", deferred."deleted_at", deferred."is_deleted", responses."account_id", deferred."diagnosis_response_id", deferred."diagnosis_question_id", deferred."deferred_at" FROM `diagnosis_deferred_questions` deferred INNER JOIN `diagnosis_responses` responses ON responses."id" = deferred."diagnosis_response_id";--> statement-breakpoint
DROP TABLE `diagnosis_deferred_questions`;--> statement-breakpoint
ALTER TABLE `__new_diagnosis_deferred_questions` RENAME TO `diagnosis_deferred_questions`;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_deferred_question_active_idx` ON `diagnosis_deferred_questions` (`diagnosis_response_id`,`diagnosis_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `__new_source_record_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`previous_source_record_id` text NOT NULL,
	`next_source_record_id` text NOT NULL,
	`derivation_method` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_source_record_id`,`account_id`) REFERENCES `source_records`(`id`,`account_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`next_source_record_id`,`account_id`) REFERENCES `source_records`(`id`,`account_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_source_record_revisions`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "account_id", "previous_source_record_id", "next_source_record_id", "derivation_method") SELECT revisions."id", revisions."created_at", revisions."updated_at", revisions."deleted_at", revisions."is_deleted", sources."account_id", revisions."previous_source_record_id", revisions."next_source_record_id", revisions."derivation_method" FROM `source_record_revisions` revisions INNER JOIN `source_records` sources ON sources."id" = revisions."previous_source_record_id";--> statement-breakpoint
DROP TABLE `source_record_revisions`;--> statement-breakpoint
ALTER TABLE `__new_source_record_revisions` RENAME TO `source_record_revisions`;--> statement-breakpoint
CREATE UNIQUE INDEX `source_record_revision_pair_idx` ON `source_record_revisions` (`previous_source_record_id`,`next_source_record_id`);--> statement-breakpoint
CREATE TRIGGER `chat_turn_response_account_insert` BEFORE INSERT ON `chat_turns` WHEN NEW.`response_message_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `conversation_messages` WHERE `id` = NEW.`response_message_id` AND `account_id` = NEW.`account_id`) BEGIN SELECT RAISE(ABORT, 'account boundary violation'); END;--> statement-breakpoint
CREATE TRIGGER `chat_turn_response_account_update` BEFORE UPDATE OF `response_message_id`, `account_id` ON `chat_turns` WHEN NEW.`response_message_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `conversation_messages` WHERE `id` = NEW.`response_message_id` AND `account_id` = NEW.`account_id`) BEGIN SELECT RAISE(ABORT, 'account boundary violation'); END;--> statement-breakpoint
CREATE TRIGGER `conversation_message_turn_account_insert` BEFORE INSERT ON `conversation_messages` WHEN NEW.`turn_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `chat_turns` WHERE `id` = NEW.`turn_id` AND `account_id` = NEW.`account_id`) BEGIN SELECT RAISE(ABORT, 'account boundary violation'); END;--> statement-breakpoint
CREATE TRIGGER `conversation_message_turn_account_update` BEFORE UPDATE OF `turn_id`, `account_id` ON `conversation_messages` WHEN NEW.`turn_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `chat_turns` WHERE `id` = NEW.`turn_id` AND `account_id` = NEW.`account_id`) BEGIN SELECT RAISE(ABORT, 'account boundary violation'); END;
