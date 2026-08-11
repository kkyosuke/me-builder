PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_profile_summary_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`generated_at` integer NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`diagnosis_input_count` integer NOT NULL,
	`diagnosis_input_latest_at` integer,
	`diary_input_count` integer NOT NULL,
	`diary_input_latest_at` integer,
	`summary_json` text NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `profile_summary_generations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_profile_summary_versions`("id", "generation_id", "sequence", "generated_at", "model", "prompt_version", "diagnosis_input_count", "diagnosis_input_latest_at", "diary_input_count", "diary_input_latest_at", "summary_json")
SELECT
	"id",
	"generation_id",
	"sequence",
	"generated_at",
	"model",
	"prompt_version",
	COALESCE(CAST(json_extract("summary_json", '$.diagnosisCount') AS integer), 0),
	CASE WHEN COALESCE(CAST(json_extract("summary_json", '$.diagnosisCount') AS integer), 0) > 0 THEN CAST(strftime('%s', json_extract("summary_json", '$.latestRecordedAt')) AS integer) * 1000 END,
	COALESCE(CAST(json_extract("summary_json", '$.diaryCount') AS integer), 0) + COALESCE((
		SELECT COUNT(DISTINCT "brain"."id")
		FROM "brain_items" AS "brain"
		WHERE "brain"."account_id" = (
			SELECT "generation"."account_id"
			FROM "profile_summary_generations" AS "generation"
			WHERE "generation"."id" = "version"."generation_id"
		)
		AND "brain"."status" = 'active'
		AND "brain"."is_deleted" = 0
		AND "brain"."created_at" <= CAST(strftime('%s', json_extract("version"."summary_json", '$.latestRecordedAt')) AS integer)
		AND "brain"."id" NOT IN (
			SELECT "head"."current_brain_item_id"
			FROM "diagnosis_brain_projection_heads" AS "head"
			WHERE "head"."account_id" = "brain"."account_id"
		)
	), 0),
	CASE WHEN json_extract("summary_json", '$.latestRecordedAt') IS NOT NULL THEN CAST(strftime('%s', json_extract("summary_json", '$.latestRecordedAt')) AS integer) * 1000 END,
	"summary_json"
FROM `profile_summary_versions` AS `version`;--> statement-breakpoint
DROP TABLE `profile_summary_versions`;--> statement-breakpoint
ALTER TABLE `__new_profile_summary_versions` RENAME TO `profile_summary_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `profile_summary_versions_generation_id_unique` ON `profile_summary_versions` (`generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profile_summary_version_sequence_idx` ON `profile_summary_versions` (`sequence`);--> statement-breakpoint
CREATE INDEX `profile_summary_version_generated_idx` ON `profile_summary_versions` (`generated_at`);
