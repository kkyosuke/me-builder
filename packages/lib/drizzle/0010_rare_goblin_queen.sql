CREATE TABLE `brain_item_access_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`label` text NOT NULL,
	`confirmation` text NOT NULL,
	`assigned_by` text NOT NULL,
	FOREIGN KEY (`brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_access_label_active_idx` ON `brain_item_access_labels` (`brain_item_id`,`label`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE INDEX `brain_item_access_label_lookup_idx` ON `brain_item_access_labels` (`account_id`,`label`,`confirmation`,`is_deleted`);--> statement-breakpoint
CREATE TABLE `brain_item_evidence_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`source_record_id` text NOT NULL,
	`relation` text NOT NULL,
	`is_derivation_trigger` integer NOT NULL,
	`derivation_method` text NOT NULL,
	`generated_at` integer NOT NULL,
	FOREIGN KEY (`brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`,`account_id`) REFERENCES `source_records`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_evidence_relation_idx` ON `brain_item_evidence_edges` (`brain_item_id`,`source_record_id`,`relation`);--> statement-breakpoint
CREATE TABLE `brain_item_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`previous_brain_item_id` text NOT NULL,
	`next_brain_item_id` text NOT NULL,
	`derivation_method` text NOT NULL,
	FOREIGN KEY (`previous_brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`next_brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_revision_pair_idx` ON `brain_item_revisions` (`previous_brain_item_id`,`next_brain_item_id`);--> statement-breakpoint
CREATE TABLE `brain_item_topic_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`brain_item_id`,`account_id`) REFERENCES `brain_items`(`id`,`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_topic_label_active_idx` ON `brain_item_topic_labels` (`brain_item_id`,`label`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE INDEX `brain_item_topic_label_lookup_idx` ON `brain_item_topic_labels` (`account_id`,`label`,`is_deleted`);--> statement-breakpoint
CREATE TABLE `brain_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`statement` text NOT NULL,
	`attributes_json` text NOT NULL,
	`derivation` text NOT NULL,
	`confirmation` text NOT NULL,
	`status` text NOT NULL,
	`valid_from` integer,
	`valid_to` integer,
	`stability` text NOT NULL,
	`sensitivity` text NOT NULL,
	`externally_shareable` integer DEFAULT false NOT NULL,
	`confidence_json` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `brain_item_lookup_idx` ON `brain_items` (`account_id`,`confirmation`,`status`,`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `brain_item_id_account_idx` ON `brain_items` (`id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_record_id_account_idx` ON `source_records` (`id`,`account_id`);