PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_compatibility_relationships` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`relationship_id` text NOT NULL,
	`inviter_account_id` text NOT NULL,
	`invitee_account_id` text,
	`inviter_display_name` text NOT NULL,
	`invitee_display_name` text,
	`offered_profile_summary_version_id` text,
	`offered_profile_fingerprint` text,
	`offered_profile_consented_at` integer,
	`accepted_profile_summary_version_id` text,
	`accepted_profile_fingerprint` text,
	`accepted_profile_consented_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`cancelled_at` integer,
	`ended_at` integer,
	`ended_by_account_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "compatibility_relationship_singleton_check" CHECK("__new_compatibility_relationships"."singleton" = 1),
	CONSTRAINT "compatibility_relationship_participant_check" CHECK("__new_compatibility_relationships"."invitee_account_id" is null or "__new_compatibility_relationships"."invitee_account_id" <> "__new_compatibility_relationships"."inviter_account_id"),
	CONSTRAINT "compatibility_relationship_accepted_participant_check" CHECK("__new_compatibility_relationships"."status" <> 'accepted' or ("__new_compatibility_relationships"."invitee_account_id" is not null and "__new_compatibility_relationships"."invitee_display_name" is not null and "__new_compatibility_relationships"."accepted_at" is not null and (("__new_compatibility_relationships"."accepted_profile_summary_version_id" is null and "__new_compatibility_relationships"."accepted_profile_fingerprint" is null and "__new_compatibility_relationships"."accepted_profile_consented_at" is null) or ("__new_compatibility_relationships"."accepted_profile_summary_version_id" is not null and "__new_compatibility_relationships"."accepted_profile_fingerprint" is not null and "__new_compatibility_relationships"."accepted_profile_consented_at" is not null))))
);
--> statement-breakpoint
INSERT INTO `__new_compatibility_relationships`("singleton", "relationship_id", "inviter_account_id", "invitee_account_id", "inviter_display_name", "invitee_display_name", "offered_profile_summary_version_id", "offered_profile_fingerprint", "offered_profile_consented_at", "accepted_profile_summary_version_id", "accepted_profile_fingerprint", "accepted_profile_consented_at", "status", "expires_at", "accepted_at", "cancelled_at", "ended_at", "ended_by_account_id", "created_at", "updated_at") SELECT "singleton", "relationship_id", "inviter_account_id", "invitee_account_id", "inviter_display_name", "invitee_display_name", NULL, NULL, NULL, NULL, NULL, NULL, "status", "expires_at", "accepted_at", "cancelled_at", "ended_at", "ended_by_account_id", "created_at", "updated_at" FROM `compatibility_relationships`;--> statement-breakpoint
DROP TABLE `compatibility_relationships`;--> statement-breakpoint
ALTER TABLE `__new_compatibility_relationships` RENAME TO `compatibility_relationships`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `compatibility_relationships_relationship_id_unique` ON `compatibility_relationships` (`relationship_id`);
