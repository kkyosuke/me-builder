CREATE TABLE `self_care_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brain_item_id`) REFERENCES `brain_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `self_care_confirmation_brain_kind_idx` ON `self_care_confirmations` (`account_id`,`brain_item_id`,`kind`);--> statement-breakpoint
CREATE INDEX `self_care_confirmation_active_idx` ON `self_care_confirmations` (`account_id`,`status`,`kind`,`updated_at`);
