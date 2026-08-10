CREATE TABLE `profile_summary_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`failure_message` text,
	`model` text,
	`prompt_version` text,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_summary_generation_active_account_idx` ON `profile_summary_generations` (`account_id`) WHERE "profile_summary_generations"."status" in ('queued', 'generating');--> statement-breakpoint
CREATE INDEX `profile_summary_generation_account_requested_idx` ON `profile_summary_generations` (`account_id`,`requested_at`);--> statement-breakpoint
CREATE TABLE `profile_summary_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`generated_at` integer NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`summary_json` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generation_id`) REFERENCES `profile_summary_generations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_summary_versions_generation_id_unique` ON `profile_summary_versions` (`generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profile_summary_version_account_sequence_idx` ON `profile_summary_versions` (`account_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `profile_summary_version_account_generated_idx` ON `profile_summary_versions` (`account_id`,`generated_at`);