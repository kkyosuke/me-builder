CREATE TABLE `ai_usage_records` (
	`request_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`period_key` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`limit_snapshot` integer NOT NULL,
	`status` text NOT NULL,
	`reserved_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`committed_at` integer,
	`released_at` integer,
	`release_reason` text,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_usage_period_order_check" CHECK("ai_usage_records"."period_start" < "ai_usage_records"."period_end"),
	CONSTRAINT "ai_usage_limit_non_negative_check" CHECK("ai_usage_records"."limit_snapshot" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ai_usage_account_period_status_idx` ON `ai_usage_records` (`account_id`,`kind`,`period_key`,`status`);--> statement-breakpoint
CREATE INDEX `ai_usage_reserved_expiry_idx` ON `ai_usage_records` (`status`,`expires_at`);
