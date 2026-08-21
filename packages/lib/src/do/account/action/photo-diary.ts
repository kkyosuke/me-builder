import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import { photoDiaryMedia, sourceRecords } from "../schema";

const DELETE_DEADLINE_MS = 24 * 60 * 60 * 1000;
export const PHOTO_DIARY_DELETION_DISPATCH_RECOVERY_MS = 30_000;

export type PhotoDiaryMimeType = "image/jpeg" | "image/png" | "image/webp";

export type ReservePhotoDiaryInput = Readonly<{
  webhookEventId: string;
  lineMessageId: string;
  mimeType: PhotoDiaryMimeType;
  byteSize: number;
  thumbnailByteSize: number;
  storageByteSize: number;
  width: number;
  height: number;
  capturedAt: Date;
  storageLimitBytes: number;
}>;

export type PhotoDiaryMediaRecord = Readonly<{
  id: string;
  sourceRecordId: string;
  originalObjectKey: string;
  thumbnailObjectKey: string;
  mimeType: PhotoDiaryMimeType;
  byteSize: number;
  thumbnailByteSize: number;
  storageByteSize: number;
  width: number;
  height: number;
  capturedAt: Date;
  storageStatus: "reserved" | "available" | "deleting" | "deleted";
  usageEligibility: "unreviewed" | "allowed" | "blocked";
}>;

export type ReservePhotoDiaryResult =
  | Readonly<{ type: "reserved" | "existing"; media: PhotoDiaryMediaRecord }>
  | Readonly<{ type: "capacity-exceeded"; usedBytes: number; limitBytes: number }>;

export async function readPhotoDiaryStorageUsage(
  db: AccountDataDatabase,
  accountId: string,
): Promise<number> {
  const [usage] = await db
    .select({ usedBytes: sql<number>`coalesce(sum(${photoDiaryMedia.storageByteSize}), 0)` })
    .from(photoDiaryMedia)
    .where(
      and(
        eq(photoDiaryMedia.accountId, accountId),
        inArray(photoDiaryMedia.storageStatus, ["reserved", "available", "deleting"]),
      ),
    );
  return Number(usage?.usedBytes ?? 0);
}

function project(row: typeof photoDiaryMedia.$inferSelect): PhotoDiaryMediaRecord {
  return {
    id: row.id,
    sourceRecordId: row.sourceRecordId,
    originalObjectKey: row.originalObjectKey,
    thumbnailObjectKey: row.thumbnailObjectKey,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    thumbnailByteSize: row.thumbnailByteSize,
    storageByteSize: row.storageByteSize,
    width: row.width,
    height: row.height,
    capturedAt: row.capturedAt,
    storageStatus: row.storageStatus,
    usageEligibility: row.usageEligibility,
  };
}

/** AccountDataの直列化境界で容量予約と二重保存防止を同時に確定する。 */
export async function reservePhotoDiaryMedia(
  db: AccountDataDatabase,
  accountId: string,
  input: ReservePhotoDiaryInput,
  at = new Date(),
): Promise<ReservePhotoDiaryResult> {
  const [existing] = await db
    .select()
    .from(photoDiaryMedia)
    .where(
      and(
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.lineMessageId, input.lineMessageId),
      ),
    )
    .limit(1);
  if (existing) return { type: "existing", media: project(existing) };

  const usedBytes = await readPhotoDiaryStorageUsage(db, accountId);
  if (usedBytes + input.storageByteSize > input.storageLimitBytes) {
    return { type: "capacity-exceeded", usedBytes, limitBytes: input.storageLimitBytes };
  }

  const mediaId = crypto.randomUUID();
  const sourceRecordId = crypto.randomUUID();
  const media = {
    id: mediaId,
    accountId,
    sourceRecordId,
    webhookEventId: input.webhookEventId,
    lineMessageId: input.lineMessageId,
    originalObjectKey: `photo-diary/${mediaId}/original`,
    thumbnailObjectKey: `photo-diary/${mediaId}/thumbnail.webp`,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    thumbnailByteSize: input.thumbnailByteSize,
    storageByteSize: input.storageByteSize,
    width: input.width,
    height: input.height,
    capturedAt: input.capturedAt,
    storageStatus: "reserved" as const,
    usageEligibility: "unreviewed" as const,
    reservedAt: at,
    createdAt: at,
    updatedAt: at,
    isDeleted: false,
    deletedAt: null,
    storedAt: null,
    deleteDueAt: null,
    deletionEnqueuedAt: null,
  };
  await db.batch([
    db.insert(sourceRecords).values({
      id: sourceRecordId,
      accountId,
      kind: "user_input",
      accessLabel: "private",
      originalRef: `line:image:${input.lineMessageId}`,
      createdAt: at,
      updatedAt: at,
    }),
    db.insert(photoDiaryMedia).values(media),
  ]);
  return { type: "reserved", media: project(media) };
}

export async function completePhotoDiaryMedia(
  db: AccountDataDatabase,
  accountId: string,
  mediaId: string,
  at = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(photoDiaryMedia)
    .set({ storageStatus: "available", storedAt: at, updatedAt: at })
    .where(
      and(
        eq(photoDiaryMedia.id, mediaId),
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.storageStatus, "reserved"),
      ),
    )
    .returning({ id: photoDiaryMedia.id });
  if (updated.length > 0) return true;
  const [existing] = await db
    .select({ status: photoDiaryMedia.storageStatus })
    .from(photoDiaryMedia)
    .where(and(eq(photoDiaryMedia.id, mediaId), eq(photoDiaryMedia.accountId, accountId)))
    .limit(1);
  return existing?.status === "available";
}

/** 再配送時にLINE contentの保存期限へ依存せず、既存保存を先に判定する。 */
export async function findPhotoDiaryMediaByLineMessage(
  db: AccountDataDatabase,
  accountId: string,
  lineMessageId: string,
): Promise<PhotoDiaryMediaRecord | null> {
  const [row] = await db
    .select()
    .from(photoDiaryMedia)
    .where(
      and(
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.lineMessageId, lineMessageId),
      ),
    )
    .limit(1);
  return row ? project(row) : null;
}

/** R2保存失敗時だけ予約と空のSourceを除去し、同じmessageの再試行を可能にする。 */
export async function releasePhotoDiaryReservation(
  db: AccountDataDatabase,
  accountId: string,
  mediaId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ sourceRecordId: photoDiaryMedia.sourceRecordId })
    .from(photoDiaryMedia)
    .where(
      and(
        eq(photoDiaryMedia.id, mediaId),
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.storageStatus, "reserved"),
      ),
    )
    .limit(1);
  if (!row) return false;
  await db.batch([
    db.delete(photoDiaryMedia).where(eq(photoDiaryMedia.id, mediaId)),
    db.delete(sourceRecords).where(eq(sourceRecords.id, row.sourceRecordId)),
  ]);
  return true;
}

export async function listPhotoDiaryMedia(
  db: AccountDataDatabase,
  accountId: string,
  limit = 50,
): Promise<readonly PhotoDiaryMediaRecord[]> {
  const rows = await db
    .select()
    .from(photoDiaryMedia)
    .where(
      and(
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.storageStatus, "available"),
        eq(photoDiaryMedia.isDeleted, false),
      ),
    )
    .orderBy(desc(photoDiaryMedia.capturedAt))
    .limit(Math.max(1, Math.min(limit, 100)));
  return rows.map(project);
}

export async function listPhotoDiaryObjectKeys(
  db: AccountDataDatabase,
  accountId: string,
): Promise<readonly string[]> {
  const rows = await db
    .select({
      originalObjectKey: photoDiaryMedia.originalObjectKey,
      thumbnailObjectKey: photoDiaryMedia.thumbnailObjectKey,
    })
    .from(photoDiaryMedia)
    .where(
      and(
        eq(photoDiaryMedia.accountId, accountId),
        inArray(photoDiaryMedia.storageStatus, ["reserved", "available", "deleting"]),
      ),
    );
  return rows.flatMap(({ originalObjectKey, thumbnailObjectKey }) => [
    originalObjectKey,
    thumbnailObjectKey,
  ]);
}

export async function getPhotoDiaryMedia(
  db: AccountDataDatabase,
  accountId: string,
  mediaId: string,
): Promise<PhotoDiaryMediaRecord | null> {
  const [row] = await db
    .select()
    .from(photoDiaryMedia)
    .where(
      and(
        eq(photoDiaryMedia.id, mediaId),
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.storageStatus, "available"),
        eq(photoDiaryMedia.isDeleted, false),
      ),
    )
    .limit(1);
  return row ? project(row) : null;
}

export async function markPhotoDiaryDeleting(
  db: AccountDataDatabase,
  accountId: string,
  mediaId: string,
  at = new Date(),
): Promise<boolean> {
  const tombstoneSource = async (sourceRecordId: string) => {
    await db
      .update(sourceRecords)
      .set({ isDeleted: true, deletedAt: at, updatedAt: at })
      .where(and(eq(sourceRecords.id, sourceRecordId), eq(sourceRecords.accountId, accountId)));
  };
  const updated = await db
    .update(photoDiaryMedia)
    .set({
      storageStatus: "deleting",
      isDeleted: true,
      deletedAt: at,
      deleteDueAt: new Date(at.getTime() + DELETE_DEADLINE_MS),
      deletionEnqueuedAt: null,
      updatedAt: at,
    })
    .where(
      and(
        eq(photoDiaryMedia.id, mediaId),
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.storageStatus, "available"),
        eq(photoDiaryMedia.isDeleted, false),
      ),
    )
    .returning({ id: photoDiaryMedia.id, sourceRecordId: photoDiaryMedia.sourceRecordId });
  if (updated[0]) {
    await tombstoneSource(updated[0].sourceRecordId);
    return true;
  }
  const [existing] = await db
    .select({
      status: photoDiaryMedia.storageStatus,
      sourceRecordId: photoDiaryMedia.sourceRecordId,
    })
    .from(photoDiaryMedia)
    .where(and(eq(photoDiaryMedia.id, mediaId), eq(photoDiaryMedia.accountId, accountId)))
    .limit(1);
  if (existing?.status !== "deleting") return false;
  await tombstoneSource(existing.sourceRecordId);
  return true;
}

/** Queue送信前に永続化した削除要求を、API失敗後もAlarmから回収できるよう列挙する。 */
export async function listUndispatchedPhotoDiaryDeletionIds(
  db: AccountDataDatabase,
  accountId: string,
): Promise<readonly string[]> {
  const rows = await db
    .select({ id: photoDiaryMedia.id })
    .from(photoDiaryMedia)
    .where(
      and(
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.storageStatus, "deleting"),
        isNull(photoDiaryMedia.deletionEnqueuedAt),
      ),
    );
  return rows.map(({ id }) => id);
}

export async function markPhotoDiaryDeletionEnqueued(
  db: AccountDataDatabase,
  accountId: string,
  mediaId: string,
  at = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(photoDiaryMedia)
    .set({ deletionEnqueuedAt: at, updatedAt: at })
    .where(
      and(
        eq(photoDiaryMedia.id, mediaId),
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.storageStatus, "deleting"),
        isNull(photoDiaryMedia.deletionEnqueuedAt),
      ),
    )
    .returning({ id: photoDiaryMedia.id });
  if (updated.length > 0) return true;
  const [existing] = await db
    .select({ enqueuedAt: photoDiaryMedia.deletionEnqueuedAt })
    .from(photoDiaryMedia)
    .where(and(eq(photoDiaryMedia.id, mediaId), eq(photoDiaryMedia.accountId, accountId)))
    .limit(1);
  return existing?.enqueuedAt !== null && existing?.enqueuedAt !== undefined;
}

export async function getDeletingPhotoDiaryMedia(
  db: AccountDataDatabase,
  accountId: string,
  mediaId: string,
): Promise<PhotoDiaryMediaRecord | null> {
  const [row] = await db
    .select()
    .from(photoDiaryMedia)
    .where(
      and(
        eq(photoDiaryMedia.id, mediaId),
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.storageStatus, "deleting"),
      ),
    )
    .limit(1);
  return row ? project(row) : null;
}

export async function completePhotoDiaryDeletion(
  db: AccountDataDatabase,
  accountId: string,
  mediaId: string,
  at = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(photoDiaryMedia)
    .set({
      storageStatus: "deleted",
      originalObjectKey: "deleted",
      thumbnailObjectKey: "deleted",
      updatedAt: at,
    })
    .where(
      and(
        eq(photoDiaryMedia.id, mediaId),
        eq(photoDiaryMedia.accountId, accountId),
        eq(photoDiaryMedia.storageStatus, "deleting"),
      ),
    )
    .returning({ id: photoDiaryMedia.id });
  return updated.length > 0;
}
