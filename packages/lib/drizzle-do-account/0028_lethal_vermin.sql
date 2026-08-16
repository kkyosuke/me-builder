CREATE TABLE `weekly_reflection_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`week_start` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`dispatched_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`failure_message` text,
	`model` text,
	`prompt_version` text,
	`notification_status` text DEFAULT 'not-applicable' NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_reflection_generation_account_week_idx` ON `weekly_reflection_generations` (`account_id`,`week_start`);--> statement-breakpoint
CREATE INDEX `weekly_reflection_generation_dispatch_idx` ON `weekly_reflection_generations` (`status`,`dispatched_at`);--> statement-breakpoint
CREATE TABLE `weekly_reflections` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`week_start` text NOT NULL,
	`generated_at` integer NOT NULL,
	`content_json` text NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `weekly_reflection_generations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_reflections_generation_id_unique` ON `weekly_reflections` (`generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_reflections_week_start_unique` ON `weekly_reflections` (`week_start`);--> statement-breakpoint
CREATE INDEX `weekly_reflection_generated_idx` ON `weekly_reflections` (`generated_at`);
