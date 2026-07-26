CREATE TABLE `account_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_account_active_idx` ON `account_identities` (`provider`,`provider_account_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL
);
