CREATE TABLE `diary_chat_brain_usage_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`turn_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`purpose` text NOT NULL,
	`status` text NOT NULL,
	`derivation` text NOT NULL,
	`confidence_json` text NOT NULL,
	`access_labels_json` text NOT NULL,
	`source_record_ids_json` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `chat_turns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brain_item_id`) REFERENCES `brain_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diary_chat_brain_usage_turn_item_idx` ON `diary_chat_brain_usage_audits` (`turn_id`,`brain_item_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `diary_chat_brain_usage_turn_idx` ON `diary_chat_brain_usage_audits` (`turn_id`);