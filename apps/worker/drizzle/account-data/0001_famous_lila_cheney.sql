DROP INDEX `brain_item_access_label_lookup_idx`;--> statement-breakpoint
CREATE INDEX `brain_item_access_label_lookup_idx` ON `brain_item_access_labels` (`account_id`,`label`,`is_deleted`);--> statement-breakpoint
ALTER TABLE `brain_item_access_labels` DROP COLUMN `confirmation`;--> statement-breakpoint
DROP INDEX `brain_item_lookup_idx`;--> statement-breakpoint
CREATE INDEX `brain_item_lookup_idx` ON `brain_items` (`account_id`,`status`,`category`);--> statement-breakpoint
ALTER TABLE `brain_items` DROP COLUMN `confirmation`;
