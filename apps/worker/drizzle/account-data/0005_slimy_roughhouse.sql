CREATE TABLE `avatar_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`selected_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `avatar_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `avatar_candidates_object_key_unique` ON `avatar_candidates` (`object_key`);--> statement-breakpoint
CREATE INDEX `avatar_candidates_job_id_idx` ON `avatar_candidates` (`job_id`);--> statement-breakpoint
CREATE TABLE `avatar_generation_events` (
	`job_id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `avatar_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `avatar_generation_events_started_at_idx` ON `avatar_generation_events` (`started_at`);--> statement-breakpoint
CREATE TABLE `avatar_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`reference_object_key` text NOT NULL,
	`reference_content_type` text NOT NULL,
	`pending_operation` text,
	`queue_pending` integer DEFAULT true NOT NULL,
	`next_enqueue_at` integer,
	`enqueue_attempt_count` integer DEFAULT 0 NOT NULL,
	`processing_lease_expires_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`model` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "avatar_jobs_attempt_count_check" CHECK("avatar_jobs"."attempt_count" >= 0),
	CONSTRAINT "avatar_jobs_enqueue_attempt_count_check" CHECK("avatar_jobs"."enqueue_attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `avatar_jobs_updated_at_idx` ON `avatar_jobs` (`updated_at`);--> statement-breakpoint
CREATE INDEX `avatar_jobs_pending_queue_idx` ON `avatar_jobs` (`queue_pending`,`next_enqueue_at`);--> statement-breakpoint
CREATE TABLE `avatar_object_deletions` (
	`object_key` text PRIMARY KEY NOT NULL,
	`delete_after` integer NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	CONSTRAINT "avatar_object_deletions_attempt_count_check" CHECK("avatar_object_deletions"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `avatar_object_deletions_due_idx` ON `avatar_object_deletions` (`delete_after`);--> statement-breakpoint
CREATE TABLE `avatar_profile` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`current_candidate_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`current_candidate_id`) REFERENCES `avatar_candidates`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "avatar_profile_singleton_check" CHECK("avatar_profile"."singleton" = 1)
);
