CREATE TABLE `profile_summary_insight_self_views` (
	`profile_summary_version_id` text NOT NULL,
	`insight_key` text NOT NULL,
	`self_view` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_summary_version_id`, `insight_key`),
	FOREIGN KEY (`profile_summary_version_id`) REFERENCES `profile_summary_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_summary_insight_self_view_updated_idx` ON `profile_summary_insight_self_views` (`updated_at`);