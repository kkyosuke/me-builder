CREATE TABLE `delivery_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`turn_id` text,
	`generation_epoch` integer,
	`target` text NOT NULL,
	`body` text NOT NULL,
	`retry_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`deadline_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `delivery_outbox_status_deadline_idx` ON `delivery_outbox` (`status`,`deadline_at`);--> statement-breakpoint
CREATE INDEX `delivery_outbox_turn_idx` ON `delivery_outbox` (`turn_id`,`generation_epoch`);--> statement-breakpoint
CREATE TABLE `receipt_reservations` (
	`event_id` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL,
	`outbox_id` text
);
--> statement-breakpoint
CREATE INDEX `receipt_reservation_outbox_idx` ON `receipt_reservations` (`outbox_id`);