CREATE TABLE `brain_vector_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`brain_item_id` text NOT NULL,
	`item_revision` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_vector_entry_item_idx` ON `brain_vector_entries` (`brain_item_id`);--> statement-breakpoint
CREATE TABLE `brain_vector_sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`brain_item_id` text NOT NULL,
	`item_revision` integer NOT NULL,
	`operation` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`mutation_id` text,
	`failure_code` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_vector_sync_job_revision_idx` ON `brain_vector_sync_jobs` (`brain_item_id`,`item_revision`,`operation`);--> statement-breakpoint
CREATE INDEX `brain_vector_sync_job_due_idx` ON `brain_vector_sync_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
INSERT INTO `brain_vector_sync_jobs` (
	`id`,
	`created_at`,
	`updated_at`,
	`is_deleted`,
	`brain_item_id`,
	`item_revision`,
	`operation`,
	`status`,
	`attempt_count`,
	`next_attempt_at`
)
SELECT
	`id` || ':' || (CAST(`updated_at` AS INTEGER) * 1000) || ':upsert',
	`updated_at`,
	`updated_at`,
	0,
	`id`,
	CAST(`updated_at` AS INTEGER) * 1000,
	'upsert',
	'pending',
	0,
	`updated_at`
FROM `brain_items`
WHERE `is_deleted` = 0 AND `status` = 'active';
