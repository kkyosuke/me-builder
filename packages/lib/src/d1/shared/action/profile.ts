import { and, eq, isNull } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { type AvatarContentType, accountProfiles } from "../schema/profile";

export type ProfileAvatarMetadata = Readonly<{
  objectKey: string;
  contentType: AvatarContentType;
  byteSize: number;
  etag: string;
  updatedAt: Date;
}>;

export type SetProfileAvatarResult = Readonly<{
  outcome: "created" | "updated" | "unchanged";
  avatar: ProfileAvatarMetadata;
  previousObjectKey: string | null;
}>;

function toAvatarMetadata(
  row: typeof accountProfiles.$inferSelect | undefined,
): ProfileAvatarMetadata | null {
  if (
    !row?.avatarObjectKey ||
    !row.avatarContentType ||
    row.avatarByteSize === null ||
    !row.avatarEtag ||
    !row.avatarUpdatedAt
  ) {
    return null;
  }
  return {
    objectKey: row.avatarObjectKey,
    contentType: row.avatarContentType,
    byteSize: row.avatarByteSize,
    etag: row.avatarEtag,
    updatedAt: row.avatarUpdatedAt,
  };
}

async function getProfileRow(db: SharedD1Client, accountId: string) {
  return db.select().from(accountProfiles).where(eq(accountProfiles.accountId, accountId)).get();
}

function matchesCurrent(row: NonNullable<Awaited<ReturnType<typeof getProfileRow>>>) {
  if (row.avatarObjectKey === null) return isNull(accountProfiles.avatarObjectKey);
  return and(
    eq(accountProfiles.avatarObjectKey, row.avatarObjectKey),
    row.avatarEtag === null
      ? isNull(accountProfiles.avatarEtag)
      : eq(accountProfiles.avatarEtag, row.avatarEtag),
    row.avatarUpdatedAt === null
      ? isNull(accountProfiles.avatarUpdatedAt)
      : eq(accountProfiles.avatarUpdatedAt, row.avatarUpdatedAt),
  );
}

/** 認証済みAccountが現在使うアバターの運営メタデータを返す。 */
export async function getProfileAvatar(
  db: SharedD1Client,
  accountId: string,
): Promise<ProfileAvatarMetadata | null> {
  const row = await getProfileRow(db, accountId);
  return toAvatarMetadata(row);
}

/** Private R2への保存完了後に、Accountの現在アバターを置換する。 */
export async function setProfileAvatar(
  db: SharedD1Client,
  accountId: string,
  avatar: ProfileAvatarMetadata,
): Promise<SetProfileAvatarResult> {
  if (!avatar.objectKey.startsWith(`accounts/${accountId}/profile/avatar/`)) {
    throw new Error("Profile avatar object does not belong to the account");
  }
  const row = {
    accountId,
    avatarObjectKey: avatar.objectKey,
    avatarContentType: avatar.contentType,
    avatarByteSize: avatar.byteSize,
    avatarEtag: avatar.etag,
    avatarUpdatedAt: avatar.updatedAt,
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const persisted = await getProfileRow(db, accountId);
    const current = toAvatarMetadata(persisted);
    if (
      current?.objectKey === avatar.objectKey &&
      current.contentType === avatar.contentType &&
      current.byteSize === avatar.byteSize &&
      current.etag === avatar.etag
    ) {
      return { outcome: "unchanged", avatar: current, previousObjectKey: current.objectKey };
    }

    if (!persisted) {
      const inserted = await db
        .insert(accountProfiles)
        .values(row)
        .onConflictDoNothing()
        .returning({ accountId: accountProfiles.accountId })
        .get();
      if (inserted) return { outcome: "created", avatar, previousObjectKey: null };
      continue;
    }

    const updated = await db
      .update(accountProfiles)
      .set(row)
      .where(and(eq(accountProfiles.accountId, accountId), matchesCurrent(persisted)))
      .returning({ accountId: accountProfiles.accountId })
      .get();
    if (updated) {
      return {
        outcome: current ? "updated" : "created",
        avatar,
        previousObjectKey: current?.objectKey ?? null,
      };
    }
  }
  throw new Error("Profile avatar update conflicted repeatedly");
}

/** 現在画像をAccount設定から外し、削除対象のPrivate R2 object keyを返す。 */
export async function clearProfileAvatar(
  db: SharedD1Client,
  accountId: string,
): Promise<Readonly<{ outcome: "cleared" | "unchanged"; previousObjectKey: string | null }>> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const persisted = await getProfileRow(db, accountId);
    const current = toAvatarMetadata(persisted);
    if (!persisted || !current) return { outcome: "unchanged", previousObjectKey: null };

    const updated = await db
      .update(accountProfiles)
      .set({
        avatarObjectKey: null,
        avatarContentType: null,
        avatarByteSize: null,
        avatarEtag: null,
        avatarUpdatedAt: null,
      })
      .where(and(eq(accountProfiles.accountId, accountId), matchesCurrent(persisted)))
      .returning({ accountId: accountProfiles.accountId })
      .get();
    if (updated) return { outcome: "cleared", previousObjectKey: current.objectKey };
  }
  throw new Error("Profile avatar clear conflicted repeatedly");
}
