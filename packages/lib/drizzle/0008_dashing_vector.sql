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
	`hard_close_at` integer NOT NULL,
	`closed_at` integer,
	`close_reason` text,
	`next_sequence` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversation_session_account_status_idx` ON `conversation_sessions` (`account_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_session_active_account_idx` ON `conversation_sessions` (`account_id`) WHERE "conversation_sessions"."status" = 'active';--> statement-breakpoint
CREATE TABLE `session_summaries` (
	`session_id` text PRIMARY KEY NOT NULL,
	`summary_json` text NOT NULL,
	`covered_through_sequence` integer NOT NULL,
	`source_message_ids_json` text NOT NULL,
	`prompt_version` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `conversation_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_record_text_payloads` (
	`source_record_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`content_type` text DEFAULT 'text/plain' NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_record_account_original_ref_idx` ON `source_records` (`account_id`,`original_ref`) WHERE "source_records"."original_ref" is not null;