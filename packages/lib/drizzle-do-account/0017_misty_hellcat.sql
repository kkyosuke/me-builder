CREATE TABLE `progression_item_states` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`brain_item_id` text NOT NULL,
	`recognized_evidence_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progression_item_state_item_idx` ON `progression_item_states` (`account_id`,`brain_item_id`);--> statement-breakpoint
CREATE TABLE `progression_pending_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`origin_type` text NOT NULL,
	`origin_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progression_pending_origin_idx` ON `progression_pending_events` (`account_id`,`origin_type`,`origin_id`);--> statement-breakpoint
CREATE INDEX `progression_pending_account_idx` ON `progression_pending_events` (`account_id`);--> statement-breakpoint
CREATE TABLE `progression_states` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`account_id` text NOT NULL,
	`growth_value` integer DEFAULT 0 NOT NULL,
	`collected_pieces` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account_data_identity`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progression_state_account_idx` ON `progression_states` (`account_id`);
--> statement-breakpoint
INSERT INTO `progression_pending_events` (
	`id`,
	`created_at`,
	`updated_at`,
	`is_deleted`,
	`account_id`,
	`origin_type`,
	`origin_id`
)
SELECT
	'progression:pending:v1:brain_item:' || `brain_items`.`id`,
	unixepoch(),
	unixepoch(),
	false,
	`brain_items`.`account_id`,
	'brain_item',
	`brain_items`.`id`
FROM `brain_items`
LEFT JOIN `progression_events`
	ON `progression_events`.`account_id` = `brain_items`.`account_id`
	AND `progression_events`.`origin_type` = 'brain_item'
	AND `progression_events`.`origin_id` = `brain_items`.`id`
WHERE `progression_events`.`id` IS NULL;
--> statement-breakpoint
INSERT INTO `progression_pending_events` (
	`id`,
	`created_at`,
	`updated_at`,
	`is_deleted`,
	`account_id`,
	`origin_type`,
	`origin_id`
)
SELECT
	'progression:pending:v1:evidence:' || `brain_item_evidence_edges`.`id`,
	unixepoch(),
	unixepoch(),
	false,
	`brain_items`.`account_id`,
	'evidence',
	`brain_item_evidence_edges`.`id`
FROM `brain_item_evidence_edges`
INNER JOIN `brain_items`
	ON `brain_items`.`id` = `brain_item_evidence_edges`.`brain_item_id`
LEFT JOIN `progression_events`
	ON `progression_events`.`account_id` = `brain_items`.`account_id`
	AND `progression_events`.`origin_type` = 'evidence'
	AND `progression_events`.`origin_id` = `brain_item_evidence_edges`.`id`
WHERE `progression_events`.`id` IS NULL;
--> statement-breakpoint
INSERT INTO `progression_item_states` (
	`id`,
	`created_at`,
	`updated_at`,
	`is_deleted`,
	`account_id`,
	`brain_item_id`,
	`recognized_evidence_count`
)
SELECT
	'progression:item-state:v1:' || `brain_items`.`id`,
	unixepoch(),
	unixepoch(),
	false,
	`brain_items`.`account_id`,
	`brain_items`.`id`,
	coalesce(sum(CASE WHEN
		`progression_events`.`id` IS NOT NULL
		AND `progression_events`.`is_deleted` = false
		AND `brain_item_evidence_edges`.`relation` = 'supports'
		AND `brain_item_evidence_edges`.`is_deleted` = false
		AND `source_records`.`is_deleted` = false
		AND `brain_items`.`status` = 'active'
		AND `brain_items`.`is_deleted` = false
		AND (`brain_items`.`valid_from` IS NULL OR `brain_items`.`valid_from` <= unixepoch())
		AND (`brain_items`.`valid_to` IS NULL OR `brain_items`.`valid_to` > unixepoch())
		AND CASE
			WHEN json_type(`brain_items`.`attributes_json`, '$.isInference') IN ('true', 'false')
				THEN json_extract(`brain_items`.`attributes_json`, '$.isInference') = false
			ELSE `brain_items`.`derivation` <> 'ai'
		END
	THEN 1 ELSE 0 END), 0)
FROM `brain_items`
LEFT JOIN `brain_item_evidence_edges`
	ON `brain_item_evidence_edges`.`brain_item_id` = `brain_items`.`id`
LEFT JOIN `source_records`
	ON `source_records`.`id` = `brain_item_evidence_edges`.`source_record_id`
LEFT JOIN `progression_events`
	ON `progression_events`.`account_id` = `brain_items`.`account_id`
	AND `progression_events`.`origin_type` = 'evidence'
	AND `progression_events`.`origin_id` = `brain_item_evidence_edges`.`id`
GROUP BY `brain_items`.`id`;
--> statement-breakpoint
INSERT INTO `progression_states` (
	`id`,
	`created_at`,
	`updated_at`,
	`is_deleted`,
	`account_id`,
	`growth_value`,
	`collected_pieces`
)
SELECT
	'progression:state:v1:' || `account_id`,
	unixepoch(),
	unixepoch(),
	false,
	`account_id`,
	coalesce(sum(`growth_delta`), 0),
	coalesce(sum(`collected_piece_delta`), 0)
FROM `progression_events`
WHERE `is_deleted` = false
GROUP BY `account_id`;
