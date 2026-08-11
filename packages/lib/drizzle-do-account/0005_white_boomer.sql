DROP INDEX `diary_brain_checkpoint_item_brain_idx`;--> statement-breakpoint
ALTER TABLE `diary_brain_checkpoint_items` ADD `operation` text DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE `diary_brain_checkpoint_items` ADD `deduplication` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `diary_brain_checkpoint_items` ADD `dedup_prompt_version` text;--> statement-breakpoint
CREATE UNIQUE INDEX `diary_brain_checkpoint_item_brain_idx` ON `diary_brain_checkpoint_items` (`checkpoint_id`,`brain_item_id`);