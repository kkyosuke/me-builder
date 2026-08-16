import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { storeLineTextSource } from "./diary";
import {
  PERSONAL_DATA_EXPORT_GENERATION_TIMEOUT_MS,
  processPendingPersonalDataExport,
  readPersonalDataArchive,
  readPersonalDataExportStatus,
  requestPersonalDataExport,
} from "./personal-data-export";

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
  return db as unknown as AccountDataDatabase;
}

async function insertRepresentativeAccount(db: AccountDataDatabase) {
  const accountId = "export-account";
  const at = new Date("2026-08-15T01:00:00.000Z");
  await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
  const oldSource = await storeLineTextSource(db, {
    accountId,
    eventId: "internal-channel-event",
    body: "訂正前の日記",
    receivedAt: at,
  });
  const newSource = await storeLineTextSource(db, {
    accountId,
    eventId: "internal-channel-event-2",
    body: "訂正後の日記",
    receivedAt: new Date(at.getTime() + 1_000),
  });
  await db.insert(schema.sourceRecordRevisions).values({
    id: "source-revision",
    previousSourceRecordId: oldSource.sourceRecordId,
    nextSourceRecordId: newSource.sourceRecordId,
    derivationMethod: "deterministic",
  });
  await db.insert(schema.conversationSessions).values({
    id: "session-1",
    accountId,
    status: "closed",
    startedAt: at,
    lastUserMessageAt: at,
    closedAt: at,
    closeReason: "explicit",
    nextSequence: 2,
  });
  await db.insert(schema.conversationMessages).values({
    id: "message-1",
    sessionId: "session-1",
    sequence: 1,
    role: "user",
    sourceRecordId: newSource.sourceRecordId,
    channel: "line",
  });
  await db.insert(schema.brainItems).values({
    id: "brain-1",
    accountId,
    category: "preference",
    statement: "静かな時間が好き",
    attributes: {},
    derivation: "ai",
    status: "active",
    stability: "changeable",
    sensitivity: "normal",
    confidence: { state: "uncomputed" },
  });
  await db.insert(schema.brainItemEvidenceEdges).values({
    id: "edge-1",
    brainItemId: "brain-1",
    sourceRecordId: newSource.sourceRecordId,
    relation: "supports",
    isDerivationTrigger: true,
    derivationMethod: "ai",
    generatedAt: at,
  });
  await db.insert(schema.compatibilityReferences).values({
    relationshipId: "relationship-must-not-export",
    accountId,
    role: "invitee",
    partnerAccountId: "partner-account-must-not-export",
    status: "active",
    createdAt: at,
    updatedAt: at,
  });
  await db.insert(schema.brainVectorSyncJobs).values({
    id: "internal-vector-job",
    brainItemId: "brain-1",
    itemRevision: 1,
    operation: "upsert",
    status: "failed",
    attemptCount: 5,
    nextAttemptAt: at,
    failureCode: "internal-failure-code",
  });
  return { accountId, oldSource, newSource };
}

describe("personal data export", () => {
  it("非同期生成し、本人の原本と履歴だけをportable archiveへ含める", async () => {
    const db = createTestDb();
    const { accountId, oldSource, newSource } = await insertRepresentativeAccount(db);
    const requestedAt = new Date("2026-08-15T02:00:00.000Z");

    const requested = await requestPersonalDataExport(db, accountId, requestedAt);
    expect(requested).toMatchObject({ outcome: "created", export: { status: "queued" } });
    await expect(requestPersonalDataExport(db, accountId, requestedAt)).resolves.toMatchObject({
      outcome: "unchanged",
      export: { id: requested.export.id },
    });

    await expect(processPendingPersonalDataExport(db, accountId, requestedAt)).resolves.toEqual({
      processed: true,
      exportId: requested.export.id,
    });
    await expect(
      readPersonalDataExportStatus(db, accountId, requested.export.id, requestedAt),
    ).resolves.toMatchObject({ status: "ready" });
    const result = await readPersonalDataArchive(db, accountId, requested.export.id, requestedAt);
    expect(result.type).toBe("ready");
    if (result.type !== "ready") throw new Error("archiveが生成されていません");
    expect(result.archive).toMatchObject({
      format: "me-builder-personal-data",
      formatVersion: 1,
      owner: { accountId },
      sourceRecords: [
        expect.objectContaining({ id: oldSource.sourceRecordId }),
        expect.objectContaining({ id: newSource.sourceRecordId }),
      ],
      sourceRecordRevisions: [
        expect.objectContaining({
          previousSourceRecordId: oldSource.sourceRecordId,
          nextSourceRecordId: newSource.sourceRecordId,
        }),
      ],
      brainItems: [expect.objectContaining({ statement: "静かな時間が好き" })],
      brainEvidence: [expect.objectContaining({ sourceRecordId: newSource.sourceRecordId })],
    });
    const serialized = JSON.stringify(result.archive);
    expect(serialized).toContain("訂正前の日記");
    expect(serialized).toContain("訂正後の日記");
    expect(serialized).not.toContain("relationship-must-not-export");
    expect(serialized).not.toContain("partner-account-must-not-export");
    expect(serialized).not.toContain("internal-vector-job");
    expect(serialized).not.toContain("internal-failure-code");
    expect(serialized).not.toContain("internal-channel-event");
  });

  it("期限切れ後はarchive本文を消去し、別Accountへは存在を返さない", async () => {
    const db = createTestDb();
    const { accountId } = await insertRepresentativeAccount(db);
    const requestedAt = new Date("2026-08-15T02:00:00.000Z");
    const requested = await requestPersonalDataExport(db, accountId, requestedAt);
    await processPendingPersonalDataExport(db, accountId, requestedAt);

    await expect(
      readPersonalDataArchive(db, "another-account", requested.export.id, requestedAt),
    ).resolves.toEqual({ type: "not-found" });
    const expiredAt = new Date(requestedAt.getTime() + 24 * 60 * 60 * 1_000 + 1);
    await expect(
      readPersonalDataArchive(db, accountId, requested.export.id, expiredAt),
    ).resolves.toEqual({ type: "expired" });
    expect(
      db
        .select()
        .from(schema.personalDataExports)
        .where(eq(schema.personalDataExports.id, requested.export.id))
        .get(),
    ).toMatchObject({ status: "expired", archiveJson: null });
  });

  it("中断されたgenerating要求を失敗へ収束させ、新しい要求を受け付ける", async () => {
    const db = createTestDb();
    const { accountId } = await insertRepresentativeAccount(db);
    const requestedAt = new Date("2026-08-15T02:00:00.000Z");
    const requested = await requestPersonalDataExport(db, accountId, requestedAt);
    await db
      .update(schema.personalDataExports)
      .set({ status: "generating", startedAt: requestedAt })
      .where(eq(schema.personalDataExports.id, requested.export.id));

    const recoveredAt = new Date(
      requestedAt.getTime() + PERSONAL_DATA_EXPORT_GENERATION_TIMEOUT_MS,
    );
    const retried = await requestPersonalDataExport(db, accountId, recoveredAt);

    expect(retried).toMatchObject({ outcome: "created", export: { status: "queued" } });
    expect(retried.export.id).not.toBe(requested.export.id);
    expect(
      db
        .select()
        .from(schema.personalDataExports)
        .where(eq(schema.personalDataExports.id, requested.export.id))
        .get(),
    ).toMatchObject({
      status: "failed",
      archiveJson: null,
      failureCode: "generation_timeout",
    });
  });
});
