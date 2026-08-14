CREATE TABLE `daily_prompt_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`local_date` text NOT NULL,
	`prompt_version` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`skip_reason` text,
	`failure_stage` text,
	`delivered_at` integer,
	`responded_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_prompt_delivery_account_date_idx` ON `daily_prompt_deliveries` (`account_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `daily_prompt_delivery_account_status_idx` ON `daily_prompt_deliveries` (`account_id`,`status`,`local_date`);