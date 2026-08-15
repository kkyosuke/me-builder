CREATE TABLE `daily_prompt_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`local_date` text NOT NULL,
	`selected_local_hour` integer NOT NULL,
	`selection_source` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_prompt_schedule_account_date_idx` ON `daily_prompt_schedules` (`account_id`,`local_date`);