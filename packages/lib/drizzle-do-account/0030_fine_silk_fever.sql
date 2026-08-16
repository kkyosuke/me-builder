CREATE TABLE `goal_follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`next_step` text NOT NULL,
	`status` text NOT NULL,
	`agreed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brain_item_id`) REFERENCES `brain_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_follow_up_brain_item_idx` ON `goal_follow_ups` (`account_id`,`brain_item_id`);--> statement-breakpoint
CREATE INDEX `goal_follow_up_active_idx` ON `goal_follow_ups` (`account_id`,`status`,`updated_at`);
