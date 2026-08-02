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
CREATE TABLE `survey_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`survey_response_id` text NOT NULL,
	`survey_question_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_version` integer NOT NULL,
	`choice_id` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`source_record_id` text NOT NULL,
	FOREIGN KEY (`survey_response_id`) REFERENCES `survey_responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`survey_question_id`) REFERENCES `survey_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`,`question_version`,`choice_id`) REFERENCES `question_choices`(`question_id`,`question_version`,`choice_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `survey_answer_current_idx` ON `survey_answers` (`survey_response_id`,`survey_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `survey_answer_source_record_idx` ON `survey_answers` (`source_record_id`);--> statement-breakpoint
CREATE TABLE `survey_deferred_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`survey_response_id` text NOT NULL,
	`survey_question_id` text NOT NULL,
	`deferred_at` integer NOT NULL,
	FOREIGN KEY (`survey_response_id`) REFERENCES `survey_responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`survey_question_id`) REFERENCES `survey_questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `survey_deferred_question_active_idx` ON `survey_deferred_questions` (`survey_response_id`,`survey_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `survey_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`survey_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_version` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`survey_id`) REFERENCES `surveys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`,`question_version`) REFERENCES `question_versions`(`question_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `survey_question_active_idx` ON `survey_questions` (`survey_id`,`question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `survey_question_position_active_idx` ON `survey_questions` (`survey_id`,`position`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `survey_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`survey_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`survey_id`) REFERENCES `surveys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `survey_response_account_active_idx` ON `survey_responses` (`account_id`,`survey_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `surveys` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`opens_at` integer NOT NULL,
	`closes_at` integer,
	`state` text NOT NULL,
	`published_at` integer,
	`withdrawn_at` integer
);
