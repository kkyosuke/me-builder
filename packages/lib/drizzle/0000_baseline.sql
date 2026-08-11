CREATE TABLE `account_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_account_active_idx` ON `account_identities` (`provider`,`provider_account_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`role` text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_versions` (
	`catalog_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`scoring_config_id` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`opens_at` integer NOT NULL,
	`closes_at` integer,
	`state` text NOT NULL,
	`published_at` integer,
	`withdrawn_at` integer,
	FOREIGN KEY (`scoring_config_id`) REFERENCES `diagnosis_scoring_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `diagnosis_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`diagnosis_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_version` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `diagnoses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`,`question_version`) REFERENCES `question_versions`(`question_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_question_active_idx` ON `diagnosis_questions` (`diagnosis_id`,`question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_question_position_active_idx` ON `diagnosis_questions` (`diagnosis_id`,`position`) WHERE is_deleted = 0;--> statement-breakpoint
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
CREATE TABLE `question_choices` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`question_id` text NOT NULL,
	`question_version` integer NOT NULL,
	`choice_id` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	`presentation` text,
	PRIMARY KEY(`question_id`, `question_version`, `choice_id`),
	FOREIGN KEY (`question_id`,`question_version`) REFERENCES `question_versions`(`question_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_choice_position_idx` ON `question_choices` (`question_id`,`question_version`,`position`);--> statement-breakpoint
CREATE TABLE `question_versions` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`question_id` text NOT NULL,
	`version` integer NOT NULL,
	`state` text NOT NULL,
	`text` text NOT NULL,
	`hint` text,
	`format` text NOT NULL,
	`approved_at` integer,
	`retired_at` integer,
	PRIMARY KEY(`question_id`, `version`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_version_active_idx` ON `question_versions` (`question_id`,`version`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gemini_usage_records` (
	`response_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`operation` text NOT NULL,
	`model` text NOT NULL,
	`prompt_token_count` integer DEFAULT 0 NOT NULL,
	`candidates_token_count` integer DEFAULT 0 NOT NULL,
	`thoughts_token_count` integer DEFAULT 0 NOT NULL,
	`cached_content_token_count` integer DEFAULT 0 NOT NULL,
	`tool_use_prompt_token_count` integer DEFAULT 0 NOT NULL,
	`total_token_count` integer DEFAULT 0 NOT NULL,
	`generated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gemini_usage_generated_at_idx` ON `gemini_usage_records` (`generated_at`);--> statement-breakpoint
CREATE INDEX `gemini_usage_account_generated_at_idx` ON `gemini_usage_records` (`account_id`,`generated_at`);