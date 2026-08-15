CREATE TABLE `family_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`payer_account_id` text NOT NULL,
	`status` text NOT NULL,
	`max_seats` integer DEFAULT 4 NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`payer_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "family_pack_max_seats_check" CHECK("family_packs"."max_seats" = 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `family_pack_active_payer_idx` ON `family_packs` (`payer_account_id`) WHERE status = 'active' and is_deleted = 0;--> statement-breakpoint
CREATE TABLE `family_seats` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`pack_id` text NOT NULL,
	`slot_number` integer NOT NULL,
	`role` text NOT NULL,
	`member_account_id` text,
	`invitation_id` text,
	`status` text NOT NULL,
	`activated_at` integer,
	`terminated_at` integer,
	FOREIGN KEY (`pack_id`) REFERENCES `family_packs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "family_seat_slot_check" CHECK("family_seats"."slot_number" between 1 and 4),
	CONSTRAINT "family_seat_role_check" CHECK(("family_seats"."role" = 'payer' and "family_seats"."slot_number" = 1 and "family_seats"."member_account_id" is not null and "family_seats"."invitation_id" is null and "family_seats"."status" in ('active', 'ended')) or ("family_seats"."role" = 'member' and "family_seats"."slot_number" between 2 and 4)),
	CONSTRAINT "family_seat_state_check" CHECK(("family_seats"."status" = 'invited' and "family_seats"."member_account_id" is null and "family_seats"."invitation_id" is not null and "family_seats"."activated_at" is null and "family_seats"."terminated_at" is null) or ("family_seats"."status" = 'active' and "family_seats"."member_account_id" is not null and "family_seats"."activated_at" is not null and "family_seats"."terminated_at" is null) or ("family_seats"."status" in ('left', 'cancelled', 'removed', 'ended') and "family_seats"."terminated_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `family_seat_live_slot_idx` ON `family_seats` (`pack_id`,`slot_number`) WHERE status in ('invited', 'active') and is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `family_seat_active_account_idx` ON `family_seats` (`member_account_id`) WHERE status = 'active' and member_account_id is not null and is_deleted = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `family_seat_invitation_idx` ON `family_seats` (`invitation_id`);--> statement-breakpoint
CREATE INDEX `family_seat_pack_status_idx` ON `family_seats` (`pack_id`,`status`,`slot_number`);