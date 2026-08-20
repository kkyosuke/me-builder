CREATE TABLE `admin_account_list_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_reference` text NOT NULL,
	`query_present` integer NOT NULL,
	`role_filter` text NOT NULL,
	`status_filter` text NOT NULL,
	`sort` text NOT NULL,
	`result_count` integer NOT NULL,
	`total` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_account_list_audit_created_idx` ON `admin_account_list_audits` (`created_at`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `last_activity_at` integer;