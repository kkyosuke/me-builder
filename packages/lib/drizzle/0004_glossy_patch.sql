DROP INDEX `account_agreement_version_idx`;--> statement-breakpoint
DROP INDEX `account_agreement_current_idx`;--> statement-breakpoint
ALTER TABLE `account_agreement_acceptances` ADD `document_hash` text;--> statement-breakpoint
UPDATE `account_agreement_acceptances`
SET `document_hash` = 'sha256:9e0143a66c525bc4784e2a6a5b0e16f511189e98b66f2da90dcb6d43cfe01836'
WHERE `document_key` = 'terms_of_service'
	AND `document_version` = '2026-08-15'
	AND `document_hash` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `account_agreement_version_idx` ON `account_agreement_acceptances` (`account_id`,`document_key`,`document_version`,`document_hash`);--> statement-breakpoint
CREATE INDEX `account_agreement_current_idx` ON `account_agreement_acceptances` (`document_key`,`document_version`,`document_hash`,`account_id`);
