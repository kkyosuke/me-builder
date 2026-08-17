DROP INDEX `billing_trial_subscription_idx`;--> statement-breakpoint
CREATE INDEX `billing_trial_subscription_idx` ON `billing_trial_usages` (`provider_subscription_id`);