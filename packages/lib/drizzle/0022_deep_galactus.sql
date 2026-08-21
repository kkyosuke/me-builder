CREATE TABLE `mcp_audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`tool_name` text NOT NULL,
	`scope` text NOT NULL,
	`access_profile` text NOT NULL,
	`outcome` text NOT NULL,
	`reason_code` text NOT NULL,
	`result_count` integer NOT NULL,
	`brain_item_ids_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `mcp_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mcp_audit_account_occurred_idx` ON `mcp_audit_records` (`account_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `mcp_audit_expiry_idx` ON `mcp_audit_records` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `mcp_authorization_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`connection_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `mcp_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_authorization_code_hash_idx` ON `mcp_authorization_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `mcp_authorization_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`metadata_hash` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`state` text,
	`code_challenge` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mcp_authorization_request_expiry_idx` ON `mcp_authorization_requests` (`expires_at`,`consumed_at`);--> statement-breakpoint
CREATE TABLE `mcp_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`metadata_hash` text NOT NULL,
	`scope` text NOT NULL,
	`access_profile` text NOT NULL,
	`status` text NOT NULL,
	`authorized_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_connection_active_client_idx` ON `mcp_connections` (`account_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `mcp_connection_account_idx` ON `mcp_connections` (`account_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `mcp_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`connection_id` text NOT NULL,
	`family_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` integer NOT NULL,
	`idle_expires_at` integer,
	`used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `mcp_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_token_hash_idx` ON `mcp_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mcp_token_connection_idx` ON `mcp_tokens` (`connection_id`,`kind`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `mcp_token_family_idx` ON `mcp_tokens` (`family_id`,`kind`,`revoked_at`);