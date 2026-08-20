CREATE TABLE `development_operation_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`result` text NOT NULL,
	`affected_count` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `development_operation_audit_created_idx` ON `development_operation_audits` (`created_at`);