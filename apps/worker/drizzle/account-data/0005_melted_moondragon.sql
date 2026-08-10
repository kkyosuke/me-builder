CREATE TABLE `brain_vector_sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`item_revision` integer NOT NULL,
	`operation` text NOT NULL,
	`status` text NOT NULL,
	`mutation_id` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`failure_code` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_vector_sync_job_revision_idx` ON `brain_vector_sync_jobs` (`brain_item_id`,`item_revision`,`operation`);--> statement-breakpoint
CREATE INDEX `brain_vector_sync_job_due_idx` ON `brain_vector_sync_jobs` (`account_id`,`status`,`next_attempt_at`);--> statement-breakpoint
INSERT INTO `brain_vector_sync_jobs` (`id`, `created_at`, `updated_at`, `is_deleted`, `account_id`, `brain_item_id`, `item_revision`, `operation`, `status`, `attempt_count`, `next_attempt_at`)
SELECT `id` || ':' || `updated_at` || ':upsert', `updated_at`, `updated_at`, 0, `account_id`, `id`, `updated_at`, 'upsert', 'pending', 0, `updated_at`
FROM `brain_items`
WHERE `status` = 'active' AND `is_deleted` = 0;
