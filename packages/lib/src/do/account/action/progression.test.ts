import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import {
  progressionLevel,
  progressionPendingStatement,
  progressionThreshold,
  readUtsushiProgression,
} from "./progression";

function createTestDb(queryLog?: string[]): AccountDataDatabase {
  const sqlite = queryLog
    ? new Database(":memory:", { verbose: (query) => queryLog.push(String(query)) })
    : new Database(":memory:");
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

async function insertSource(
  db: AccountDataDatabase,
  accountId: string,
  id: string,
  at: Date,
  contentHash?: string,
) {
  await db.insert(schema.sourceRecords).values({
    id,
    accountId,
    kind: "user_input",
    createdAt: at,
    updatedAt: at,
  });
  if (contentHash) {
    await db.insert(schema.sourceRecordTextPayloads).values({
      sourceRecordId: id,
      body: `${id} body`,
      contentHash,
      createdAt: at,
    });
  }
}

async function insertItem(
  db: AccountDataDatabase,
  accountId: string,
  id: string,
  category: string,
  at: Date,
  attributes: unknown = {},
) {
  await db.batch([
    db.insert(schema.brainItems).values({
      id,
      accountId,
      category,
      statement: `${id} statement`,
      attributes,
      derivation: "deterministic",
      status: "active",
      stability: "changeable",
      sensitivity: "normal",
      externallyShareable: false,
      confidence: {},
      createdAt: at,
      updatedAt: at,
    }),
    progressionPendingStatement(db, { accountId, originType: "brain_item", originId: id, at }),
  ]);
}

async function insertEvidence(
  db: AccountDataDatabase,
  accountId: string,
  id: string,
  brainItemId: string,
  sourceRecordId: string,
  at: Date,
) {
  await db.batch([
    db.insert(schema.brainItemEvidenceEdges).values({
      id,
      brainItemId,
      sourceRecordId,
      relation: "supports",
      isDerivationTrigger: true,
      derivationMethod: "deterministic",
      generatedAt: at,
      createdAt: at,
      updatedAt: at,
    }),
    progressionPendingStatement(db, { accountId, originType: "evidence", originId: id, at }),
  ]);
}

describe("Utsushi progression", () => {
  it("二次式から上限なしのレベルと閾値を求める", () => {
    expect([1, 2, 3, 4, 5].map(progressionThreshold)).toEqual([0, 5, 20, 45, 80]);
    expect([0, 4, 5, 19, 20, 1_000_000].map(progressionLevel)).toEqual([1, 1, 2, 2, 3, 448]);
  });

  it("データがなくてもLv.1を返す", async () => {
    const db = createTestDb();
    const accountId = "empty-account";
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });

    await expect(readUtsushiProgression(db, accountId)).resolves.toEqual({
      level: 1,
      growthValue: 0,
      currentLevelThreshold: 0,
      nextLevelThreshold: 5,
      collectedPieces: 0,
      activePieces: 0,
      categoryCount: 0,
      calculationVersion: 1,
      highestLevel: 1,
      recentChanges: [],
      milestoneCards: [],
    });
  });

  it("既存Brainを開始値にし、追加・再読込・削除を冪等に扱う", async () => {
    const db = createTestDb();
    const accountId = "progression-account";
    const at = new Date("2026-08-15T00:00:00.000Z");
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
    await insertSource(db, accountId, "source-1", at);
    await insertSource(db, accountId, "source-2", at);
    await insertItem(db, accountId, "item-1", "preference", at);
    await insertEvidence(db, accountId, "edge-1", "item-1", "source-1", at);
    await insertEvidence(db, accountId, "edge-2", "item-1", "source-2", new Date(at.getTime() + 1));
    await db.insert(schema.brainItems).values({
      id: "inference-1",
      accountId,
      category: "identity",
      statement: "AI inference",
      attributes: { isInference: true },
      derivation: "ai",
      status: "active",
      stability: "changeable",
      sensitivity: "normal",
      externallyShareable: false,
      confidence: {},
      createdAt: at,
      updatedAt: at,
    });

    await expect(readUtsushiProgression(db, accountId, at)).resolves.toEqual({
      level: 1,
      growthValue: 4,
      currentLevelThreshold: 0,
      nextLevelThreshold: 5,
      collectedPieces: 2,
      activePieces: 2,
      categoryCount: 2,
      calculationVersion: 1,
      highestLevel: 1,
      recentChanges: [
        {
          kind: "evidence_deepened",
          growthDelta: 1,
          occurredAt: "2026-08-15T00:00:00.000Z",
        },
        { kind: "new_piece", growthDelta: 3, occurredAt: "2026-08-15T00:00:00.000Z" },
      ],
      milestoneCards: [],
    });

    const later = new Date(at.getTime() + 10);
    await insertSource(db, accountId, "source-3", later);
    await insertItem(db, accountId, "item-2", "goal", later);
    await insertEvidence(db, accountId, "edge-3", "item-2", "source-3", later);
    const afterAddition = {
      level: 2,
      growthValue: 7,
      currentLevelThreshold: 5,
      nextLevelThreshold: 20,
      collectedPieces: 3,
      activePieces: 3,
      categoryCount: 3,
      calculationVersion: 1,
      highestLevel: 2,
      recentChanges: [
        {
          kind: "evidence_deepened",
          growthDelta: 1,
          occurredAt: at.toISOString(),
        },
        { kind: "new_piece", growthDelta: 3, occurredAt: at.toISOString() },
        { kind: "new_piece", growthDelta: 3, occurredAt: at.toISOString() },
      ],
      milestoneCards: [],
    };
    await expect(readUtsushiProgression(db, accountId, later)).resolves.toEqual(afterAddition);
    await expect(readUtsushiProgression(db, accountId, later)).resolves.toEqual(afterAddition);

    await db
      .update(schema.brainItems)
      .set({ isDeleted: true, deletedAt: later, updatedAt: later })
      .where(eq(schema.brainItems.id, "item-2"));
    await expect(readUtsushiProgression(db, accountId, later)).resolves.toEqual({
      ...afterAddition,
      activePieces: 2,
      categoryCount: 2,
    });
  });

  it("初回同期後は全Evidenceと全イベントを再走査しない", async () => {
    const queryLog: string[] = [];
    const db = createTestDb(queryLog);
    const accountId = "incremental-account";
    const at = new Date("2026-08-15T00:00:00.000Z");
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
    await insertSource(db, accountId, "source-1", at);
    await insertItem(db, accountId, "item-1", "preference", at);
    await insertEvidence(db, accountId, "edge-1", "item-1", "source-1", at);

    await readUtsushiProgression(db, accountId, at);
    queryLog.length = 0;

    await expect(readUtsushiProgression(db, accountId, at)).resolves.toMatchObject({
      growthValue: 3,
      collectedPieces: 1,
    });
    const normalizedQueries = queryLog.map((query) => query.toLowerCase());
    expect(normalizedQueries.some((query) => query.includes("brain_item_evidence_edges"))).toBe(
      false,
    );
    expect(
      normalizedQueries.some(
        (query) => query.includes("sum(") && query.includes("progression_events"),
      ),
    ).toBe(false);
  });

  it("同じ本文hashのEvidenceを再送しても成長値を増やさない", async () => {
    const db = createTestDb();
    const accountId = "duplicate-evidence-account";
    const at = new Date("2026-08-15T00:00:00.000Z");
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
    await insertSource(db, accountId, "source-1", at, "same-content");
    await insertItem(db, accountId, "item-1", "preference", at);
    await insertEvidence(db, accountId, "edge-1", "item-1", "source-1", at);
    await expect(readUtsushiProgression(db, accountId, at)).resolves.toMatchObject({
      growthValue: 3,
    });

    const later = new Date(at.getTime() + 1);
    await insertSource(db, accountId, "source-2", later, "same-content");
    await insertEvidence(db, accountId, "edge-2", "item-1", "source-2", later);
    await expect(readUtsushiProgression(db, accountId, later)).resolves.toMatchObject({
      growthValue: 3,
    });
    expect(
      db
        .select({ kind: schema.progressionEvents.kind })
        .from(schema.progressionEvents)
        .where(eq(schema.progressionEvents.originId, "edge-2"))
        .get(),
    ).toEqual({ kind: "duplicate_evidence" });
  });

  it("Revisionの保存済み種別に従い、時間変化だけを加点する", async () => {
    const db = createTestDb();
    const accountId = "revision-kind-account";
    const at = new Date("2026-08-15T00:00:00.000Z");
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
    await insertItem(db, accountId, "item-1", "goal", at);
    await readUtsushiProgression(db, accountId, at);

    const temporalAt = new Date(at.getTime() + 1);
    await insertItem(db, accountId, "item-2", "goal", temporalAt);
    await db.insert(schema.brainItemRevisions).values({
      id: "revision-temporal",
      previousBrainItemId: "item-1",
      nextBrainItemId: "item-2",
      derivationMethod: "ai",
      changeKind: "temporal",
      createdAt: temporalAt,
      updatedAt: temporalAt,
    });
    await expect(readUtsushiProgression(db, accountId, temporalAt)).resolves.toMatchObject({
      growthValue: 5,
    });

    const correctionAt = new Date(at.getTime() + 2);
    await insertItem(db, accountId, "item-3", "goal", correctionAt);
    await db.insert(schema.brainItemRevisions).values({
      id: "revision-correction",
      previousBrainItemId: "item-2",
      nextBrainItemId: "item-3",
      derivationMethod: "ai",
      changeKind: "correction",
      createdAt: correctionAt,
      updatedAt: correctionAt,
    });
    await expect(readUtsushiProgression(db, accountId, correctionAt)).resolves.toMatchObject({
      growthValue: 5,
      calculationVersion: 1,
      highestLevel: 2,
    });
  });

  it("再計算後も保存済みの最高到達レベルを下回らない", async () => {
    const db = createTestDb();
    const accountId = "highest-level-account";
    const at = new Date("2026-08-15T00:00:00.000Z");
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
    await insertItem(db, accountId, "item-1", "goal", at);
    await readUtsushiProgression(db, accountId, at);
    await db
      .update(schema.progressionStates)
      .set({ highestLevel: 10 })
      .where(eq(schema.progressionStates.accountId, accountId));

    await expect(readUtsushiProgression(db, accountId, at)).resolves.toMatchObject({
      level: 10,
      highestLevel: 10,
      growthValue: 3,
    });
  });

  it("10レベルごとの到達を本文なしの成長カードとして一度だけ保存する", async () => {
    const db = createTestDb();
    const accountId = "milestone-account";
    const at = new Date("2026-08-15T00:00:00.000Z");
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
    await insertItem(db, accountId, "item-1", "goal", at);
    await insertItem(db, accountId, "item-2", "preference", at);
    await readUtsushiProgression(db, accountId, at);
    await db
      .update(schema.progressionStates)
      .set({ growthValue: 405, collectedPieces: 12, highestLevel: 10 })
      .where(eq(schema.progressionStates.accountId, accountId));

    const reachedAt = new Date("2026-08-16T00:00:00.000Z");
    await expect(readUtsushiProgression(db, accountId, reachedAt)).resolves.toMatchObject({
      milestoneCards: [
        {
          level: 10,
          reachedAt: reachedAt.toISOString(),
          collectedPiecesDelta: 12,
          categories: ["goal", "preference"],
        },
      ],
    });
    await readUtsushiProgression(db, accountId, reachedAt);
    expect(await db.select().from(schema.progressionMilestones).all()).toHaveLength(1);

    await db
      .update(schema.progressionStates)
      .set({ growthValue: 1_805, collectedPieces: 30, highestLevel: 20 })
      .where(eq(schema.progressionStates.accountId, accountId));
    const nextReachedAt = new Date("2026-08-17T00:00:00.000Z");
    await expect(readUtsushiProgression(db, accountId, nextReachedAt)).resolves.toMatchObject({
      milestoneCards: [
        {
          level: 20,
          reachedAt: nextReachedAt.toISOString(),
          collectedPiecesDelta: 18,
        },
        { level: 10 },
      ],
    });
  });
});
