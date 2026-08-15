CREATE TABLE `billing_reconciliation_audits` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`admin_account_id` text NOT NULL,
	`target_account_id` text NOT NULL,
	`mode` text NOT NULL,
	`difference_fields` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admin_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `billing_reconciliation_target_idx` ON `billing_reconciliation_audits` (`target_account_id`,`created_at`);