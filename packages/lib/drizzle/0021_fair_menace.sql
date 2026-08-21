CREATE TABLE `account_terms_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`document_version` text NOT NULL,
	`channel` text NOT NULL,
	`disposition` text NOT NULL,
	`delivered_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_terms_notification_once_idx` ON `account_terms_notifications` (`account_id`,`document_version`,`channel`);--> statement-breakpoint
CREATE INDEX `account_terms_notification_version_idx` ON `account_terms_notifications` (`document_version`,`channel`,`account_id`);