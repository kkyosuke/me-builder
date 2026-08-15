import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import {
  claimDueBrainVectorSyncJobs,
  completeBrainVectorSyncJob,
  getBrainVectorSyncTarget,
} from "./brain";
import { deleteAllDevelopmentAccountData } from "./development";
import { storeLineTextSource } from "./diary";

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  Object.assign(db, {
    batch: async (queries: readonly PromiseLike<unknown>[]) => {
      const results = [];
      for (const query of queries) results.push(await query);
      return results;
    },
  });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  return db as unknown as AccountDataDatabase;
}

describe("deleteAllDevelopmentAccountData", () => {
  it("リセット前epochの日記Sourceを保存しない", async () => {
    const db = createTestDb();
    const accountId = "account-1";
    db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId, resetEpoch: 2 }).run();

    await expect(
      storeLineTextSource(db, {
        accountId,
        resetEpoch: 1,
        eventId: "stale-event",
        body: "古い受付",
        receivedAt: new Date("2026-08-13T00:00:00.000Z"),
      }),
    ).rejects.toThrow("reset epoch is stale");
    expect(db.select().from(schema.sourceRecords).all()).toEqual([]);
  });

  it("遅れて到着した古いリセットは新しいepochのデータを削除しない", async () => {
    const db = createTestDb();
    const accountId = "account-1";
    db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId, resetEpoch: 2 }).run();
    await storeLineTextSource(db, {
      accountId,
      resetEpoch: 2,
      eventId: "fresh-event",
      body: "新しい受付",
      receivedAt: new Date("2026-08-13T00:00:00.000Z"),
    });

    await expect(deleteAllDevelopmentAccountData(db, accountId, 1)).resolves.toStrictEqual({
      deletedDiagnosisResponseCount: 0,
      deletedConversationSessionCount: 0,
      deletedSourceRecordCount: 0,
      deletedBrainItemCount: 0,
      deletedProfileSummaryVersionCount: 0,
      scheduledVectorDeletionCount: 0,
    });
    expect(db.select().from(schema.sourceRecords).all()).toHaveLength(1);
    expect(db.select().from(schema.accountDataIdentity).get()?.resetEpoch).toBe(2);
  });

  it("声かけ停止の根拠と状態をSource Recordとともに削除する", async () => {
    const db = createTestDb();
    const accountId = "account-1";
    db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId }).run();
    await storeLineTextSource(db, {
      accountId,
      eventId: "stop-message",
      body: "声かけを止めて",
      receivedAt: new Date("2026-08-13T00:00:00.000Z"),
      dailyPromptControl: "stop",
    });
    db.insert(schema.dailyPromptSchedules)
      .values({
        id: "daily-prompt-schedule:2026-08-13",
        accountId,
        localDate: "2026-08-13",
        selectedLocalHour: 20,
        selectionSource: "learned",
      })
      .run();

    await deleteAllDevelopmentAccountData(db, accountId, 1);

    expect(db.select().from(schema.dailyPromptPreferences).all()).toEqual([]);
    expect(db.select().from(schema.dailyPromptSchedules).all()).toEqual([]);
    expect(db.select().from(schema.sourceRecords).all()).toEqual([]);
  });

  it("処理中upsertがdelete後に完了しても補正deleteを再登録する", async () => {
    const db = createTestDb();
    const accountId = "account-1";
    const brainItemId = "brain-1";
    const oldRevision = 100;
    const resetAt = new Date("2026-08-13T00:00:00.000Z");
    db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId }).run();
    db.insert(schema.brainItems)
      .values({
        id: brainItemId,
        accountId,
        category: "memory",
        statement: "削除対象の記憶",
        attributes: {},
        derivation: "ai",
        status: "active",
        stability: "stable",
        sensitivity: "private",
        externallyShareable: false,
        confidence: {},
      })
      .run();
    db.insert(schema.brainVectorEntries)
      .values({ id: "vector-1", brainItemId, itemRevision: oldRevision })
      .run();
    db.insert(schema.brainVectorSyncJobs)
      .values({
        id: "old-upsert",
        brainItemId,
        itemRevision: oldRevision,
        operation: "upsert",
        status: "submitted",
        attemptCount: 1,
        nextAttemptAt: new Date("2027-01-01T00:00:00.000Z"),
      })
      .run();

    await expect(
      getBrainVectorSyncTarget(db, accountId, "old-upsert", brainItemId, oldRevision),
    ).resolves.toMatchObject({ action: "upsert" });

    await deleteAllDevelopmentAccountData(db, accountId, 1, resetAt);
    const firstDelete = (await claimDueBrainVectorSyncJobs(db, resetAt)).jobs[0];
    expect(firstDelete).toBeDefined();
    if (!firstDelete) throw new Error("Reset delete job was not claimed");
    await completeBrainVectorSyncJob(
      db,
      accountId,
      firstDelete.id,
      { action: "delete", vectorId: "vector-1" },
      "delete-first",
      resetAt,
    );

    await expect(
      completeBrainVectorSyncJob(
        db,
        accountId,
        "old-upsert",
        { action: "upsert", vectorId: "vector-1", itemRevision: oldRevision },
        "late-upsert",
        resetAt,
      ),
    ).resolves.toBe(true);
    expect(db.select().from(schema.brainVectorEntries).all()).toHaveLength(1);

    const correction = (await claimDueBrainVectorSyncJobs(db, resetAt)).jobs.find(
      ({ brainItemId: id }) => id === brainItemId,
    );
    expect(correction).toBeDefined();
    if (!correction) throw new Error("Correction delete job was not claimed");
    await completeBrainVectorSyncJob(
      db,
      accountId,
      correction.id,
      { action: "delete", vectorId: "vector-1" },
      "delete-correction",
      resetAt,
    );

    expect(db.select().from(schema.brainVectorEntries).all()).toEqual([]);
    expect(
      db
        .select({ resetEpoch: schema.accountDataIdentity.resetEpoch })
        .from(schema.accountDataIdentity)
        .where(eq(schema.accountDataIdentity.accountId, accountId))
        .get()?.resetEpoch,
    ).toBe(1);
  });
});
