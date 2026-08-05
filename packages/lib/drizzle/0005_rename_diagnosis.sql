ALTER TABLE `surveys` RENAME TO `diagnoses`;--> statement-breakpoint
ALTER TABLE `survey_answers` RENAME TO `diagnosis_answers`;--> statement-breakpoint
ALTER TABLE `survey_deferred_questions` RENAME TO `diagnosis_deferred_questions`;--> statement-breakpoint
ALTER TABLE `survey_questions` RENAME TO `diagnosis_questions`;--> statement-breakpoint
ALTER TABLE `survey_responses` RENAME TO `diagnosis_responses`;--> statement-breakpoint
ALTER TABLE `diagnosis_answers` RENAME COLUMN "survey_response_id" TO "diagnosis_response_id";--> statement-breakpoint
ALTER TABLE `diagnosis_answers` RENAME COLUMN "survey_question_id" TO "diagnosis_question_id";--> statement-breakpoint
ALTER TABLE `diagnosis_deferred_questions` RENAME COLUMN "survey_response_id" TO "diagnosis_response_id";--> statement-breakpoint
ALTER TABLE `diagnosis_deferred_questions` RENAME COLUMN "survey_question_id" TO "diagnosis_question_id";--> statement-breakpoint
ALTER TABLE `diagnosis_questions` RENAME COLUMN "survey_id" TO "diagnosis_id";--> statement-breakpoint
ALTER TABLE `diagnosis_responses` RENAME COLUMN "survey_id" TO "diagnosis_id";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
UPDATE `diagnosis_answers` SET `diagnosis_question_id` = 'dq-' || substr(`diagnosis_question_id`, 4) WHERE `diagnosis_question_id` LIKE 'sq-%';--> statement-breakpoint
UPDATE `diagnosis_deferred_questions` SET `diagnosis_question_id` = 'dq-' || substr(`diagnosis_question_id`, 4) WHERE `diagnosis_question_id` LIKE 'sq-%';--> statement-breakpoint
UPDATE `diagnosis_questions` SET `id` = 'dq-' || substr(`id`, 4) WHERE `id` LIKE 'sq-%';--> statement-breakpoint
CREATE TABLE `__new_diagnosis_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`diagnosis_response_id` text NOT NULL,
	`diagnosis_question_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_version` integer NOT NULL,
	`choice_id` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`source_record_id` text NOT NULL,
	FOREIGN KEY (`diagnosis_response_id`) REFERENCES `diagnosis_responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_question_id`) REFERENCES `diagnosis_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`,`question_version`,`choice_id`) REFERENCES `question_choices`(`question_id`,`question_version`,`choice_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_diagnosis_answers`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "diagnosis_question_id", "question_id", "question_version", "choice_id", "accepted_at", "source_record_id") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "diagnosis_question_id", "question_id", "question_version", "choice_id", "accepted_at", "source_record_id" FROM `diagnosis_answers`;--> statement-breakpoint
DROP TABLE `diagnosis_answers`;--> statement-breakpoint
ALTER TABLE `__new_diagnosis_answers` RENAME TO `diagnosis_answers`;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_answer_current_idx` ON `diagnosis_answers` (`diagnosis_response_id`,`diagnosis_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_answer_source_record_idx` ON `diagnosis_answers` (`source_record_id`);--> statement-breakpoint
CREATE TABLE `__new_diagnosis_deferred_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`diagnosis_response_id` text NOT NULL,
	`diagnosis_question_id` text NOT NULL,
	`deferred_at` integer NOT NULL,
	FOREIGN KEY (`diagnosis_response_id`) REFERENCES `diagnosis_responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_question_id`) REFERENCES `diagnosis_questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_diagnosis_deferred_questions`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "diagnosis_question_id", "deferred_at") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_response_id", "diagnosis_question_id", "deferred_at" FROM `diagnosis_deferred_questions`;--> statement-breakpoint
DROP TABLE `diagnosis_deferred_questions`;--> statement-breakpoint
ALTER TABLE `__new_diagnosis_deferred_questions` RENAME TO `diagnosis_deferred_questions`;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_deferred_question_active_idx` ON `diagnosis_deferred_questions` (`diagnosis_response_id`,`diagnosis_question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `__new_diagnosis_questions` (
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
INSERT INTO `__new_diagnosis_questions`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_id", "question_id", "question_version", "position") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "diagnosis_id", "question_id", "question_version", "position" FROM `diagnosis_questions`;--> statement-breakpoint
DROP TABLE `diagnosis_questions`;--> statement-breakpoint
ALTER TABLE `__new_diagnosis_questions` RENAME TO `diagnosis_questions`;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_question_active_idx` ON `diagnosis_questions` (`diagnosis_id`,`question_id`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_question_position_active_idx` ON `diagnosis_questions` (`diagnosis_id`,`position`) WHERE is_deleted = 0;--> statement-breakpoint
CREATE TABLE `__new_diagnosis_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`diagnosis_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `diagnoses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_diagnosis_responses`("id", "created_at", "updated_at", "deleted_at", "is_deleted", "account_id", "diagnosis_id") SELECT "id", "created_at", "updated_at", "deleted_at", "is_deleted", "account_id", "diagnosis_id" FROM `diagnosis_responses`;--> statement-breakpoint
DROP TABLE `diagnosis_responses`;--> statement-breakpoint
ALTER TABLE `__new_diagnosis_responses` RENAME TO `diagnosis_responses`;--> statement-breakpoint
CREATE UNIQUE INDEX `diagnosis_response_account_active_idx` ON `diagnosis_responses` (`account_id`,`diagnosis_id`) WHERE is_deleted = 0;--> statement-breakpoint
PRAGMA foreign_keys=ON;
