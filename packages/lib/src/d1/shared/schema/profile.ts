import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./account";

export const avatarContentTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarContentType = (typeof avatarContentTypes)[number];

/** Account運営情報と、Private R2にある現在のアバターを結ぶメタデータ。 */
export const accountProfiles = sqliteTable(
  "account_profiles",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id),
    displayName: text("display_name"),
    displayNameUpdatedAt: integer("display_name_updated_at", { mode: "timestamp_ms" }),
    avatarObjectKey: text("avatar_object_key"),
    avatarContentType: text("avatar_content_type", { enum: avatarContentTypes }),
    avatarByteSize: integer("avatar_byte_size"),
    avatarEtag: text("avatar_etag"),
    avatarUpdatedAt: integer("avatar_updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check(
      "account_profile_display_name_check",
      sql`(${table.displayName} is null and ${table.displayNameUpdatedAt} is null) or (length(trim(${table.displayName})) > 0 and ${table.displayNameUpdatedAt} is not null)`,
    ),
    check(
      "account_profile_avatar_metadata_check",
      sql`(${table.avatarObjectKey} is null and ${table.avatarContentType} is null and ${table.avatarByteSize} is null and ${table.avatarEtag} is null and ${table.avatarUpdatedAt} is null) or (${table.avatarObjectKey} is not null and ${table.avatarContentType} in ('image/jpeg', 'image/png', 'image/webp') and ${table.avatarByteSize} > 0 and ${table.avatarEtag} is not null and ${table.avatarUpdatedAt} is not null)`,
    ),
  ],
);
