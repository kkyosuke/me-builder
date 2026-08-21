CREATE TABLE `photo_diary_media` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`source_record_id` text NOT NULL,
	`webhook_event_id` text NOT NULL,
	`line_message_id` text NOT NULL,
	`original_object_key` text NOT NULL,
	`thumbnail_object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`thumbnail_byte_size` integer NOT NULL,
	`storage_byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`storage_status` text DEFAULT 'reserved' NOT NULL,
	`usage_eligibility` text DEFAULT 'unreviewed' NOT NULL,
	`reserved_at` integer NOT NULL,
	`stored_at` integer,
	`delete_due_at` integer,
	`deletion_enqueued_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_diary_media_account_message_idx` ON `photo_diary_media` (`account_id`,`line_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_diary_media_account_webhook_idx` ON `photo_diary_media` (`account_id`,`webhook_event_id`);--> statement-breakpoint
CREATE INDEX `photo_diary_media_account_status_idx` ON `photo_diary_media` (`account_id`,`storage_status`,`captured_at`);