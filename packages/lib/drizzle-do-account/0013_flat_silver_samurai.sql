PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_daily_prompt_preferences` (
	`account_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`controlled_at` integer NOT NULL,
	`control_source_record_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`control_source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_daily_prompt_preferences`("account_id", "status", "controlled_at", "control_source_record_id", "updated_at") SELECT "account_id", "status", "stopped_at" * 1000, "stopped_source_record_id", "updated_at" FROM `daily_prompt_preferences`;--> statement-breakpoint
DROP TABLE `daily_prompt_preferences`;--> statement-breakpoint
ALTER TABLE `__new_daily_prompt_preferences` RENAME TO `daily_prompt_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
