CREATE TABLE `family_seat_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`seat_id` text NOT NULL,
	`inviter_account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_by_account_id` text,
	`consumed_at` integer,
	FOREIGN KEY (`seat_id`) REFERENCES `family_seats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inviter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claimed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "family_seat_invitation_state_check" CHECK(("family_seat_invitations"."status" = 'pending' and "family_seat_invitations"."claimed_by_account_id" is null and "family_seat_invitations"."consumed_at" is null) or ("family_seat_invitations"."status" = 'accepted' and "family_seat_invitations"."claimed_by_account_id" is not null and "family_seat_invitations"."consumed_at" is not null) or ("family_seat_invitations"."status" in ('declined', 'cancelled', 'expired') and "family_seat_invitations"."consumed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `family_seat_invitation_seat_idx` ON `family_seat_invitations` (`seat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `family_seat_invitation_token_idx` ON `family_seat_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `family_seat_invitation_status_expiry_idx` ON `family_seat_invitations` (`status`,`expires_at`);