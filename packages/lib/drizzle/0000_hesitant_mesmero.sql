CREATE TABLE `account_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_account_active_idx` ON `account_identities` (`provider`,`provider_account_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`role` text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brain_item_access_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`label` text NOT NULL,
	`confirmation` text NOT NULL,
	`assigned_by` text NOT NULL,
	FOREIGN KEY (`brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_access_label_active_idx` ON `brain_item_access_labels` (`brain_item_id`,`label`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE INDEX `brain_item_access_label_lookup_idx` ON `brain_item_access_labels` (`account_id`,`label`,`confirmation`,`is_deleted`);--> statement-breakpoint
CREATE TABLE `brain_item_evidence_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`source_record_id` text NOT NULL,
	`relation` text NOT NULL,
	`is_derivation_trigger` integer NOT NULL,
	`derivation_method` text NOT NULL,
	`generated_at` integer NOT NULL,
	FOREIGN KEY (`brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`,`account_id`) REFERENCES `source_records`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_evidence_relation_idx` ON `brain_item_evidence_edges` (`brain_item_id`,`source_record_id`,`relation`);--> statement-breakpoint
CREATE TABLE `brain_item_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`previous_brain_item_id` text NOT NULL,
	`next_brain_item_id` text NOT NULL,
	`derivation_method` text NOT NULL,
	FOREIGN KEY (`previous_brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`next_brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_revision_pair_idx` ON `brain_item_revisions` (`previous_brain_item_id`,`next_brain_item_id`);--> statement-breakpoint
CREATE TABLE `brain_item_topic_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_topic_label_active_idx` ON `brain_item_topic_labels` (`brain_item_id`,`label`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE INDEX `brain_item_topic_label_lookup_idx` ON `brain_item_topic_labels` (`account_id`,`label`,`is_deleted`);--> statement-breakpoint
CREATE TABLE `brain_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`statement` text NOT NULL,
	`attributes_json` text NOT NULL,
	`derivation` text NOT NULL,
	`confirmation` text NOT NULL,
	`status` text NOT NULL,
	`valid_from` integer,
	`valid_to` integer,
	`stability` text NOT NULL,
	`sensitivity` text NOT NULL,
	`externally_shareable` integer DEFAULT false NOT NULL,
	`confidence_json` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `brain_item_lookup_idx` ON `brain_items` (`account_id`,`confirmation`,`status`,`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_id_account_idx` ON `brain_items` (`id`,`account_id`);--> statement-breakpoint
CREATE TABLE `chat_turns` (
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
CREATE INDEX `chat_turn_status_created_idx` ON `chat_turns` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_turn_session_range_idx` ON `chat_turns` (`session_id`,`from_sequence`,`through_sequence`);--> statement-breakpoint
CREATE TABLE `conversation_messages` (
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
CREATE UNIQUE INDEX `conversation_message_session_sequence_idx` ON `conversation_messages` (`session_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_message_channel_event_idx` ON `conversation_messages` (`channel`,`channel_event_id`) WHERE "conversation_messages"."channel_event_id" is not null;--> statement-breakpoint
CREATE TABLE `conversation_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` integer NOT NULL,
	`last_user_message_at` integer NOT NULL,
	`last_assistant_message_at` integer,
	`closed_at` integer,
	`close_reason` text,
	`conversation_policy_id` text DEFAULT 'reflective' NOT NULL,
	`reply_opportunity_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`awaiting_reply` integer DEFAULT false NOT NULL,
	`next_sequence` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversation_session_account_status_idx` ON `conversation_sessions` (`account_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_session_active_account_idx` ON `conversation_sessions` (`account_id`) WHERE "conversation_sessions"."status" = 'active';--> statement-breakpoint
CREATE TABLE `source_record_text_payloads` (
	`source_record_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`content_type` text DEFAULT 'text/plain' NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`scoring_config_id` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`opens_at` integer NOT NULL,
	`closes_at` integer,
	`state` text NOT NULL,
	`published_at` integer,
	`withdrawn_at` integer,
	FOREIGN KEY (`scoring_config_id`) REFERENCES `diagnosis_scoring_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `diagnosis_answers` (
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
CREATE UNIQUE INDEX `diagnosis_answer_current_idx` ON `diagnosis_answers` (`diagnosis_response_id`,`diagnosis_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_answer_source_record_idx` ON `diagnosis_answers` (`source_record_id`);--> statement-breakpoint
CREATE TABLE `diagnosis_brain_projection_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`diagnosis_id` text NOT NULL,
	`scoring_config_id` text NOT NULL,
	`scoring_config_version` integer NOT NULL,
	`parameter_id` text NOT NULL,
	`current_brain_item_id` text NOT NULL,
	`content_signature` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `diagnoses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scoring_config_id`) REFERENCES `diagnosis_scoring_configs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_brain_projection_identity_idx` ON `diagnosis_brain_projection_heads` (`account_id`,`diagnosis_id`,`scoring_config_id`,`scoring_config_version`,`parameter_id`);--> statement-breakpoint
CREATE TABLE `diagnosis_brain_projection_requests` (
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
CREATE UNIQUE INDEX `diagnosis_brain_projection_revision_idx` ON `diagnosis_brain_projection_requests` (`diagnosis_response_id`,`response_revision`);--> statement-breakpoint
CREATE INDEX `diagnosis_brain_projection_pending_idx` ON `diagnosis_brain_projection_requests` (`status`,`next_attempt_at`) WHERE status IN ('pending', 'failed') AND is_deleted = 0;--> statement-breakpoint
CREATE TABLE `diagnosis_deferred_questions` (
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
CREATE UNIQUE INDEX `diagnosis_deferred_question_active_idx` ON `diagnosis_deferred_questions` (`diagnosis_response_id`,`diagnosis_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `diagnosis_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`diagnosis_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_version` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `diagnoses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`,`question_version`) REFERENCES `question_versions`(`question_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_question_active_idx` ON `diagnosis_questions` (`diagnosis_id`,`question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_question_position_active_idx` ON `diagnosis_questions` (`diagnosis_id`,`position`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `diagnosis_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`diagnosis_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `diagnoses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_response_account_active_idx` ON `diagnosis_responses` (`account_id`,`diagnosis_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `diagnosis_scoring_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `question_choices` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`question_id` text NOT NULL,
	`question_version` integer NOT NULL,
	`choice_id` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	`presentation` text,
	PRIMARY KEY(`question_id`, `question_version`, `choice_id`),
	FOREIGN KEY (`question_id`,`question_version`) REFERENCES `question_versions`(`question_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_choice_position_idx` ON `question_choices` (`question_id`,`question_version`,`position`);--> statement-breakpoint
CREATE TABLE `question_versions` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`question_id` text NOT NULL,
	`version` integer NOT NULL,
	`state` text NOT NULL,
	`text` text NOT NULL,
	`hint` text,
	`format` text NOT NULL,
	`approved_at` integer,
	`retired_at` integer,
	PRIMARY KEY(`question_id`, `version`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_version_active_idx` ON `question_versions` (`question_id`,`version`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_record_revisions` (
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
CREATE UNIQUE INDEX `source_record_revision_pair_idx` ON `source_record_revisions` (`previous_source_record_id`,`next_source_record_id`);--> statement-breakpoint
CREATE TABLE `source_records` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`access_label` text DEFAULT 'private' NOT NULL,
	`original_ref` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_record_id_account_idx` ON `source_records` (`id`,`account_id`);