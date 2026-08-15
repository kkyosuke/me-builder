CREATE TABLE `account_agreement_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`document_key` text NOT NULL,
	`document_version` text NOT NULL,
	`accepted_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_agreement_version_idx` ON `account_agreement_acceptances` (`account_id`,`document_key`,`document_version`);--> statement-breakpoint
CREATE INDEX `account_agreement_current_idx` ON `account_agreement_acceptances` (`document_key`,`document_version`,`account_id`);