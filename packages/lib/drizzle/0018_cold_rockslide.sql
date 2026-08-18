CREATE TABLE `sso_authentication_transaction_claims` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
