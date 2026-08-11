CREATE TABLE `profile_summary_share_projections` (
	`profile_summary_version_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`generated_at` integer NOT NULL,
	`statements_json` text NOT NULL,
	`evidence_references_json` text NOT NULL,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`profile_summary_version_id`) REFERENCES `profile_summary_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `profile_summary_share_projection_generated_idx` ON `profile_summary_share_projections` (`generated_at`);