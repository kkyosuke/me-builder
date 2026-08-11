CREATE TABLE `account_profiles` (
	`account_id` text PRIMARY KEY NOT NULL,
	`avatar_object_key` text,
	`avatar_content_type` text,
	`avatar_byte_size` integer,
	`avatar_etag` text,
	`avatar_updated_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_profile_avatar_metadata_check" CHECK(("account_profiles"."avatar_object_key" is null and "account_profiles"."avatar_content_type" is null and "account_profiles"."avatar_byte_size" is null and "account_profiles"."avatar_etag" is null and "account_profiles"."avatar_updated_at" is null) or ("account_profiles"."avatar_object_key" is not null and "account_profiles"."avatar_content_type" in ('image/jpeg', 'image/png', 'image/webp') and "account_profiles"."avatar_byte_size" > 0 and "account_profiles"."avatar_etag" is not null and "account_profiles"."avatar_updated_at" is not null))
);
