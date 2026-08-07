CREATE TABLE `accepted_messages` (
	`event_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`source_record_id` text NOT NULL,
	`received_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accepted_message_status_received_idx` ON `accepted_messages` (`status`,`received_at`);--> statement-breakpoint
CREATE TABLE `attach_batch_messages` (
	`event_id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `accepted_messages`(`event_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `attach_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attach_batch_message_batch_idx` ON `attach_batch_messages` (`batch_id`);--> statement-breakpoint
CREATE TABLE `attach_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_epoch` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coordinator_identity` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	CONSTRAINT "coordinator_identity_singleton_check" CHECK("coordinator_identity"."singleton" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coordinator_identity_account_id_unique` ON `coordinator_identity` (`account_id`);--> statement-breakpoint
CREATE TABLE `coordinator_state` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`generation_epoch` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "coordinator_state_singleton_check" CHECK("coordinator_state"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `local_turns` (
	`turn_id` text PRIMARY KEY NOT NULL,
	`generation_epoch` integer NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`hard_deadline_at` integer
);
