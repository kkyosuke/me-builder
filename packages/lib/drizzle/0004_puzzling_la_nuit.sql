PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_survey_answers` (
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
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`,`question_version`,`choice_id`) REFERENCES `question_choices`(`question_id`,`question_version`,`choice_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_survey_answers`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "survey_response_id", "survey_question_id", "question_id", "question_version", "choice_id", "accepted_at", "source_record_id") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "survey_response_id", "survey_question_id", "question_id", "question_version", "choice_id", "accepted_at", "source_record_id" FROM `survey_answers`;--> statement-breakpoint
DROP TABLE `survey_answers`;--> statement-breakpoint
ALTER TABLE `__new_survey_answers` RENAME TO `survey_answers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `survey_answer_current_idx` ON `survey_answers` (`survey_response_id`,`survey_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `survey_answer_source_record_idx` ON `survey_answers` (`source_record_id`);--> statement-breakpoint
CREATE TABLE `__new_source_record_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`previous_source_record_id` text NOT NULL,
	`next_source_record_id` text NOT NULL,
	`derivation_method` text NOT NULL,
	FOREIGN KEY (`previous_source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`next_source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_source_record_revisions`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "previous_source_record_id", "next_source_record_id", "derivation_method") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "previous_source_record_id", "next_source_record_id", "derivation_method" FROM `source_record_revisions`;--> statement-breakpoint
DROP TABLE `source_record_revisions`;--> statement-breakpoint
ALTER TABLE `__new_source_record_revisions` RENAME TO `source_record_revisions`;--> statement-breakpoint
CREATE UNIQUE INDEX `source_record_revision_pair_idx` ON `source_record_revisions` (`previous_source_record_id`,`next_source_record_id`);