CREATE TABLE `compatibility_progression_states` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`growth_value` integer DEFAULT 0 NOT NULL,
	`highest_level` integer DEFAULT 1 NOT NULL,
	`comparable_theme_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "compatibility_progression_state_singleton_check" CHECK("compatibility_progression_states"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `compatibility_progression_themes` (
	`diagnosis_id` text PRIMARY KEY NOT NULL,
	`result_fingerprint` text NOT NULL,
	`first_compared_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
