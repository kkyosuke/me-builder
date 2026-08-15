CREATE TABLE `progression_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`origin_type` text NOT NULL,
	`origin_id` text NOT NULL,
	`kind` text NOT NULL,
	`growth_delta` integer NOT NULL,
	`collected_piece_delta` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progression_event_origin_idx` ON `progression_events` (`account_id`,`origin_type`,`origin_id`);--> statement-breakpoint
CREATE INDEX `progression_event_account_idx` ON `progression_events` (`account_id`,`is_deleted`);