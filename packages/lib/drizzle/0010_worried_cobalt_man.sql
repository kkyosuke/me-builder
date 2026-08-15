CREATE TABLE `account_recovery_rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`locked_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_recovery_locked_until_idx` ON `account_recovery_rate_limits` (`locked_until`);--> statement-breakpoint
ALTER TABLE `account_recovery_audits` ADD `reason` text;