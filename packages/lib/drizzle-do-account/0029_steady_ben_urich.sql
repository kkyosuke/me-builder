CREATE TABLE `monthly_change_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`month` text NOT NULL,
	`version` integer NOT NULL,
	`generated_at` integer NOT NULL,
	`content_json` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_change_account_month_version_idx` ON `monthly_change_versions` (`account_id`,`month`,`version`);--> statement-breakpoint
CREATE INDEX `monthly_change_generated_idx` ON `monthly_change_versions` (`account_id`,`generated_at`);
