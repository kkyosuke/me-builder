CREATE TABLE `billing_customers` (
	`account_id` text PRIMARY KEY NOT NULL,
	`provider_customer_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_synced_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customer_provider_idx` ON `billing_customers` (`provider_customer_id`);--> statement-breakpoint
CREATE TABLE `billing_processed_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`object_id` text NOT NULL,
	`event_created_at` integer NOT NULL,
	`processed_at` integer NOT NULL,
	`disposition` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `billing_processed_object_idx` ON `billing_processed_events` (`object_id`,`event_created_at`);--> statement-breakpoint
CREATE TABLE `billing_subscription_projections` (
	`provider_subscription_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_customer_id` text NOT NULL,
	`status` text NOT NULL,
	`plan_code` text,
	`current_period_start` integer,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`trial_end` integer,
	`provider_created_at` integer NOT NULL,
	`last_event_created_at` integer NOT NULL,
	`last_synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "billing_subscription_period_check" CHECK("billing_subscription_projections"."current_period_start" is null or "billing_subscription_projections"."current_period_end" is null or "billing_subscription_projections"."current_period_start" <= "billing_subscription_projections"."current_period_end")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_customer_idx` ON `billing_subscription_projections` (`provider_customer_id`);--> statement-breakpoint
CREATE INDEX `billing_subscription_account_idx` ON `billing_subscription_projections` (`account_id`);