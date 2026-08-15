import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { progressionLevel, progressionThreshold, readUtsushiProgression } from "./progression";

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

function insertSource(db: AccountDataDatabase, accountId: string, id: string, at: Date) {
  return db.insert(schema.sourceRecords).values({
    id,
    accountId,
    kind: "user_input",
    createdAt: at,
    updatedAt: at,
  });
}

function insertItem(
  db: AccountDataDatabase,
  accountId: string,
  id: string,
  category: string,
  at: Date,
  attributes: unknown = {},
) {
  return db.insert(schema.brainItems).values({
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
  });
}

function insertEvidence(
  db: AccountDataDatabase,
  id: string,
  brainItemId: string,
  sourceRecordId: string,
  at: Date,
) {
  return db.insert(schema.brainItemEvidenceEdges).values({
    id,
    brainItemId,
    sourceRecordId,
    relation: "supports",
    isDerivationTrigger: true,
    derivationMethod: "deterministic",
    generatedAt: at,
    createdAt: at,
    updatedAt: at,
  });
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
    await insertEvidence(db, "edge-1", "item-1", "source-1", at);
    await insertEvidence(db, "edge-2", "item-1", "source-2", new Date(at.getTime() + 1));
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
    });

    const later = new Date(at.getTime() + 10);
    await insertSource(db, accountId, "source-3", later);
    await insertItem(db, accountId, "item-2", "goal", later);
    await insertEvidence(db, "edge-3", "item-2", "source-3", later);
    const afterAddition = {
      level: 2,
      growthValue: 7,
      currentLevelThreshold: 5,
      nextLevelThreshold: 20,
      collectedPieces: 3,
      activePieces: 3,
      categoryCount: 3,
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
});
