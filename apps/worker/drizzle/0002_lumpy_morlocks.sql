DELETE FROM `delivery_outbox` WHERE `kind` = 'receipt';--> statement-breakpoint
DROP TABLE `receipt_reservations`;
