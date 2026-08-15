ALTER TABLE `brain_item_revisions` ADD `change_kind` text DEFAULT 'correction' NOT NULL;--> statement-breakpoint
ALTER TABLE `progression_events` ADD `calculation_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `progression_item_states` ADD `recognized_evidence_fingerprints_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `progression_states` ADD `calculation_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `progression_states` ADD `highest_level` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `progression_events`
SET `kind` = 'initial_evidence'
WHERE `kind` = 'evidence_added' AND `growth_delta` = 0;--> statement-breakpoint
DELETE FROM `progression_item_states`;--> statement-breakpoint
DELETE FROM `progression_states`;
