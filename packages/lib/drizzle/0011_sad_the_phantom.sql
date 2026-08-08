CREATE TABLE `diagnosis_brain_projection_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`diagnosis_id` text NOT NULL,
	`scoring_config_id` text NOT NULL,
	`scoring_config_version` integer NOT NULL,
	`parameter_id` text NOT NULL,
	`current_brain_item_id` text NOT NULL,
	`content_signature` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `diagnoses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scoring_config_id`) REFERENCES `diagnosis_scoring_configs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_brain_projection_identity_idx` ON `diagnosis_brain_projection_heads` (`account_id`,`diagnosis_id`,`scoring_config_id`,`scoring_config_version`,`parameter_id`);--> statement-breakpoint
CREATE TABLE `diagnosis_brain_projection_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`diagnosis_response_id` text NOT NULL,
	`response_revision` integer NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`failure_code` text,
	FOREIGN KEY (`diagnosis_response_id`) REFERENCES `diagnosis_responses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_brain_projection_revision_idx` ON `diagnosis_brain_projection_requests` (`diagnosis_response_id`,`response_revision`);--> statement-breakpoint
CREATE INDEX `diagnosis_brain_projection_pending_idx` ON `diagnosis_brain_projection_requests` (`status`,`next_attempt_at`) WHERE status IN ('pending', 'failed') AND is_deleted = 0;--> statement-breakpoint
ALTER TABLE `diagnosis_responses` ADD `revision` integer DEFAULT 0 NOT NULL;