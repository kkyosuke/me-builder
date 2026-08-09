CREATE TABLE `compatibility_references` (
	`relationship_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`partner_account_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "compatibility_reference_state_check" CHECK(("compatibility_references"."status" = 'pending' and "compatibility_references"."role" = 'inviter' and "compatibility_references"."partner_account_id" is null) or ("compatibility_references"."status" = 'reserved' and "compatibility_references"."partner_account_id" is not null) or ("compatibility_references"."status" = 'active' and "compatibility_references"."partner_account_id" is not null) or "compatibility_references"."status" = 'ended')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compatibility_reference_active_partner_idx` ON `compatibility_references` (`partner_account_id`) WHERE "compatibility_references"."status" in ('reserved', 'active');--> statement-breakpoint
CREATE INDEX `compatibility_reference_status_updated_idx` ON `compatibility_references` (`status`,`updated_at`);
