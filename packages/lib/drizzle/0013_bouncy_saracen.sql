CREATE TABLE `billing_trial_usages` (
	`account_id` text PRIMARY KEY NOT NULL,
	`provider_subscription_id` text NOT NULL,
	`first_started_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_trial_subscription_idx` ON `billing_trial_usages` (`provider_subscription_id`);