CREATE TABLE `account_progression_projections` (
	`account_id` text PRIMARY KEY NOT NULL,
	`calculation_version` integer NOT NULL,
	`level` integer NOT NULL,
	`growth_value` integer NOT NULL,
	`collected_pieces` integer NOT NULL,
	`active_pieces` integer NOT NULL,
	`last_growth_at` integer,
	`projected_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_progression_projection_values_check" CHECK("account_progression_projections"."calculation_version" > 0 and "account_progression_projections"."level" > 0 and "account_progression_projections"."growth_value" >= 0 and "account_progression_projections"."collected_pieces" >= 0 and "account_progression_projections"."active_pieces" >= 0)
);
--> statement-breakpoint
CREATE INDEX `account_progression_level_idx` ON `account_progression_projections` (`level`,`account_id`);--> statement-breakpoint
CREATE INDEX `account_progression_pieces_idx` ON `account_progression_projections` (`collected_pieces`,`account_id`);--> statement-breakpoint
CREATE INDEX `account_progression_growth_at_idx` ON `account_progression_projections` (`last_growth_at`,`account_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_profiles` (
	`account_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`display_name_updated_at` integer,
	`avatar_object_key` text,
	`avatar_content_type` text,
	`avatar_byte_size` integer,
	`avatar_etag` text,
	`avatar_updated_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_profile_display_name_check" CHECK(("__new_account_profiles"."display_name" is null and "__new_account_profiles"."display_name_updated_at" is null) or (length(trim("__new_account_profiles"."display_name")) > 0 and "__new_account_profiles"."display_name_updated_at" is not null)),
	CONSTRAINT "account_profile_avatar_metadata_check" CHECK(("__new_account_profiles"."avatar_object_key" is null and "__new_account_profiles"."avatar_content_type" is null and "__new_account_profiles"."avatar_byte_size" is null and "__new_account_profiles"."avatar_etag" is null and "__new_account_profiles"."avatar_updated_at" is null) or ("__new_account_profiles"."avatar_object_key" is not null and "__new_account_profiles"."avatar_content_type" in ('image/jpeg', 'image/png', 'image/webp') and "__new_account_profiles"."avatar_byte_size" > 0 and "__new_account_profiles"."avatar_etag" is not null and "__new_account_profiles"."avatar_updated_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_account_profiles`("account_id", "display_name", "display_name_updated_at", "avatar_object_key", "avatar_content_type", "avatar_byte_size", "avatar_etag", "avatar_updated_at") SELECT "account_id", NULL, NULL, "avatar_object_key", "avatar_content_type", "avatar_byte_size", "avatar_etag", "avatar_updated_at" FROM `account_profiles`;--> statement-breakpoint
DROP TABLE `account_profiles`;--> statement-breakpoint
ALTER TABLE `__new_account_profiles` RENAME TO `account_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
