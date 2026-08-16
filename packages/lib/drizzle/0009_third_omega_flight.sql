CREATE TABLE `account_recovery_audits` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`identity_fingerprint` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_recovery_audit_account_idx` ON `account_recovery_audits` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `account_recovery_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`secret_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_identity_hash` text,
	`claimed_at` integer,
	`used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_recovery_account_idx` ON `account_recovery_credentials` (`account_id`,`created_at`);