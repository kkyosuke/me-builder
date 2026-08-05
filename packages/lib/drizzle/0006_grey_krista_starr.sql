CREATE TABLE `diagnosis_scoring_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `diagnoses` ADD `scoring_config_id` text REFERENCES diagnosis_scoring_configs(id);