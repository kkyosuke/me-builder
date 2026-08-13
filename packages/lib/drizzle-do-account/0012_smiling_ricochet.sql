CREATE TABLE `daily_prompt_preferences` (
	`account_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`stopped_at` integer NOT NULL,
	`stopped_source_record_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stopped_source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE no action
);
