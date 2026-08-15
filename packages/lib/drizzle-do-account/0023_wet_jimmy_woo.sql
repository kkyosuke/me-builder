CREATE TABLE `progression_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`level` integer NOT NULL,
	`collected_pieces_delta` integer NOT NULL,
	`collected_pieces_total` integer NOT NULL,
	`categories_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progression_milestone_account_level_idx` ON `progression_milestones` (`account_id`,`level`);