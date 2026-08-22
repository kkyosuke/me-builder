import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import {
  completePhotoDiaryDeletion,
  completePhotoDiaryMedia,
  findPhotoDiaryMediaByLineMessage,
  getPhotoDiaryMedia,
  listPhotoDiaryMedia,
  listUndispatchedPhotoDiaryDeletionIds,
  markPhotoDiaryDeleting,
  markPhotoDiaryDeletionEnqueued,
  reservePhotoDiaryMedia,
} from "./photo-diary";

const ACCOUNT_ID = "account-photo";
const NOW = new Date("2026-08-22T01:00:00.000Z");

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  type RunnableQuery = PromiseLike<unknown> & { run(): unknown };
  const runBatch = sqlite.transaction((queries: RunnableQuery[]) =>
    queries.map((query) => query.run()),
  );
  Object.assign(db, { batch: async (queries: RunnableQuery[]) => runBatch(queries) });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: ACCOUNT_ID }).run();
  return db as unknown as AccountDataDatabase;
}

function input(messageId: string, storageLimitBytes = 1_200) {
  return {
    webhookEventId: `event-${messageId}`,
    lineMessageId: messageId,
    mimeType: "image/jpeg" as const,
    byteSize: 1_000,
    thumbnailByteSize: 100,
    storageByteSize: 1_100,
    width: 800,
    height: 600,
    capturedAt: NOW,
    storageLimitBytes,
  };
}

describe("photo diary media", () => {
  it("原本とthumbnailの合計を直列化された容量予約へ数え、再配送を重複させない", async () => {
    const db = createTestDb();
    const first = await reservePhotoDiaryMedia(db, ACCOUNT_ID, input("message-1"), NOW);
    const duplicate = await reservePhotoDiaryMedia(db, ACCOUNT_ID, input("message-1"), NOW);
    const overCapacity = await reservePhotoDiaryMedia(db, ACCOUNT_ID, input("message-2"), NOW);
    if (first.type === "capacity-exceeded" || duplicate.type === "capacity-exceeded") {
      throw new Error("fixture reservation failed");
    }

    expect(first).toMatchObject({
      type: "reserved",
      media: { storageStatus: "reserved", storageByteSize: 1_100 },
    });
    expect(duplicate).toMatchObject({ type: "existing", media: { id: first.media.id } });
    expect(overCapacity).toEqual({
      type: "capacity-exceeded",
      usedBytes: 1_100,
      limitBytes: 1_200,
    });
    expect(await findPhotoDiaryMediaByLineMessage(db, ACCOUNT_ID, "message-1")).toMatchObject({
      id: first.media.id,
    });
    expect(db.select().from(schema.sourceRecords).all()).toHaveLength(1);
  });

  it("削除要求で即時に閲覧対象から外し、物理削除後はR2 keyをtombstoneへ残さない", async () => {
    const db = createTestDb();
    const reserved = await reservePhotoDiaryMedia(db, ACCOUNT_ID, input("message-1"), NOW);
    if (reserved.type === "capacity-exceeded") throw new Error("fixture reservation failed");
    await completePhotoDiaryMedia(db, ACCOUNT_ID, reserved.media.id, NOW);
    expect(await listPhotoDiaryMedia(db, ACCOUNT_ID)).toHaveLength(1);

    await expect(markPhotoDiaryDeleting(db, ACCOUNT_ID, reserved.media.id, NOW)).resolves.toBe(
      true,
    );
    await expect(getPhotoDiaryMedia(db, ACCOUNT_ID, reserved.media.id)).resolves.toBeNull();
    await expect(listUndispatchedPhotoDiaryDeletionIds(db, ACCOUNT_ID)).resolves.toEqual([
      reserved.media.id,
    ]);
    await expect(
      markPhotoDiaryDeletionEnqueued(db, ACCOUNT_ID, reserved.media.id, NOW),
    ).resolves.toBe(true);
    await expect(listUndispatchedPhotoDiaryDeletionIds(db, ACCOUNT_ID)).resolves.toEqual([]);
    expect(db.select().from(schema.sourceRecords).get()).toMatchObject({ isDeleted: true });
    await expect(completePhotoDiaryDeletion(db, ACCOUNT_ID, reserved.media.id, NOW)).resolves.toBe(
      true,
    );

    const row = db.select().from(schema.photoDiaryMedia).get();
    expect(row).toMatchObject({
      storageStatus: "deleted",
      originalObjectKey: "deleted",
      thumbnailObjectKey: "deleted",
      isDeleted: true,
    });
    expect(db.select().from(schema.brainItems).all()).toHaveLength(0);
    expect(db.select().from(schema.brainVectorEntries).all()).toHaveLength(0);
    expect(db.select().from(schema.sourceRecordTextPayloads).all()).toHaveLength(0);
  });
});
