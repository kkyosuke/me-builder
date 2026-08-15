CREATE TABLE `personal_data_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`expires_at` integer,
	`archive_json` text,
	`failure_code` text,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_data_export_active_account_idx` ON `personal_data_exports` (`account_id`) WHERE "personal_data_exports"."status" in ('queued', 'generating');--> statement-breakpoint
CREATE INDEX `personal_data_export_account_requested_idx` ON `personal_data_exports` (`account_id`,`requested_at`);
