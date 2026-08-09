CREATE TABLE `compatibility_accepted_themes` (
	`relationship_id` text NOT NULL,
	`diagnosis_id` text NOT NULL,
	`result_fingerprint` text NOT NULL,
	`consented_at` integer NOT NULL,
	PRIMARY KEY(`relationship_id`, `diagnosis_id`),
	FOREIGN KEY (`relationship_id`,`diagnosis_id`) REFERENCES `compatibility_offered_themes`(`relationship_id`,`diagnosis_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `compatibility_offered_themes` (
	`relationship_id` text NOT NULL,
	`diagnosis_id` text NOT NULL,
	`result_fingerprint` text NOT NULL,
	`consented_at` integer NOT NULL,
	PRIMARY KEY(`relationship_id`, `diagnosis_id`),
	FOREIGN KEY (`relationship_id`) REFERENCES `compatibility_relationships`(`relationship_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `compatibility_relationships` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`relationship_id` text NOT NULL,
	`inviter_account_id` text NOT NULL,
	`invitee_account_id` text,
	`inviter_display_name` text NOT NULL,
	`invitee_display_name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`cancelled_at` integer,
	`ended_at` integer,
	`ended_by_account_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "compatibility_relationship_singleton_check" CHECK("compatibility_relationships"."singleton" = 1),
	CONSTRAINT "compatibility_relationship_participant_check" CHECK("compatibility_relationships"."invitee_account_id" is null or "compatibility_relationships"."invitee_account_id" <> "compatibility_relationships"."inviter_account_id"),
	CONSTRAINT "compatibility_relationship_accepted_participant_check" CHECK("compatibility_relationships"."status" <> 'accepted' or ("compatibility_relationships"."invitee_account_id" is not null and "compatibility_relationships"."invitee_display_name" is not null and "compatibility_relationships"."accepted_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compatibility_relationships_relationship_id_unique` ON `compatibility_relationships` (`relationship_id`);