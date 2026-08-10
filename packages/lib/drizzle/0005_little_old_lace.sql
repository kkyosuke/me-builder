CREATE TABLE `brain_vector_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`item_revision` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_vector_entry_item_idx` ON `brain_vector_entries` (`account_id`,`brain_item_id`);