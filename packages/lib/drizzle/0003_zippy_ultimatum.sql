CREATE TABLE `diary_brain_checkpoint_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`checkpoint_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `diary_brain_checkpoints`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brain_item_id`) REFERENCES `brain_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diary_brain_checkpoint_item_position_idx` ON `diary_brain_checkpoint_items` (`checkpoint_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `diary_brain_checkpoint_item_brain_idx` ON `diary_brain_checkpoint_items` (`brain_item_id`);--> statement-breakpoint
ALTER TABLE `diary_brain_checkpoints` ADD `development_notification_sent_at` integer;