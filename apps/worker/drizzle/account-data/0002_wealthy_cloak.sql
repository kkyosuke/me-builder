CREATE TABLE `diary_brain_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`session_id` text NOT NULL,
	`from_sequence` integer NOT NULL,
	`through_sequence` integer NOT NULL,
	`first_message_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`applied_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `conversation_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diary_brain_checkpoint_pending_session_idx` ON `diary_brain_checkpoints` (`session_id`) WHERE "diary_brain_checkpoints"."status" = 'pending' AND "diary_brain_checkpoints"."is_deleted" = 0;--> statement-breakpoint
CREATE INDEX `diary_brain_checkpoint_due_idx` ON `diary_brain_checkpoints` (`status`,`next_attempt_at`,`is_deleted`);