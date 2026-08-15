ALTER TABLE `progression_events` ADD `category` text;
--> statement-breakpoint
UPDATE `progression_events`
SET `category` = (
  SELECT `brain_items`.`category`
  FROM `brain_items`
  WHERE `brain_items`.`id` = `progression_events`.`origin_id`
)
WHERE `progression_events`.`origin_type` = 'brain_item';
--> statement-breakpoint
UPDATE `progression_events`
SET `category` = (
  SELECT `brain_items`.`category`
  FROM `brain_item_evidence_edges`
  INNER JOIN `brain_items`
    ON `brain_items`.`id` = `brain_item_evidence_edges`.`brain_item_id`
  WHERE `brain_item_evidence_edges`.`id` = `progression_events`.`origin_id`
)
WHERE `progression_events`.`origin_type` = 'evidence';
