ALTER TABLE `chat_turns` ADD `delivery_metric_token` text;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `conversation_policy_id` text DEFAULT 'reflective' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `reply_opportunity_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `reply_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `awaiting_reply` integer DEFAULT false NOT NULL;