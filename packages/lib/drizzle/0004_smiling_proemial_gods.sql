CREATE TABLE `gemini_usage_records` (
	`response_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`operation` text NOT NULL,
	`model` text NOT NULL,
	`prompt_token_count` integer DEFAULT 0 NOT NULL,
	`candidates_token_count` integer DEFAULT 0 NOT NULL,
	`thoughts_token_count` integer DEFAULT 0 NOT NULL,
	`cached_content_token_count` integer DEFAULT 0 NOT NULL,
	`tool_use_prompt_token_count` integer DEFAULT 0 NOT NULL,
	`total_token_count` integer DEFAULT 0 NOT NULL,
	`generated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gemini_usage_generated_at_idx` ON `gemini_usage_records` (`generated_at`);--> statement-breakpoint
CREATE INDEX `gemini_usage_account_generated_at_idx` ON `gemini_usage_records` (`account_id`,`generated_at`);