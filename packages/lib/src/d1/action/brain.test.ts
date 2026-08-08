import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import { type SaveBrainItemInput, saveBrainItem } from "./brain";

function createTestDb(): D1Client {
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
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  return db as unknown as D1Client;
}

function createInput(overrides: Partial<SaveBrainItemInput> = {}): SaveBrainItemInput {
  return {
    item: {
      id: "brain-1",
      accountId: "account-1",
      category: "preference",
      statement: "日記から見える傾向",
      attributes: { sourceKind: "diary" },
      derivation: "ai",
      confirmation: "pending",
      status: "active",
      stability: "changeable",
      sensitivity: "normal",
      externallyShareable: false,
      confidence: { state: "uncomputed" },
    },
    evidence: [
      {
        id: "evidence-1",
        sourceRecordId: "source-1",
        relation: "supports",
        isDerivationTrigger: true,
        derivationMethod: "ai",
        generatedAt: new Date("2026-08-08T00:00:00Z"),
      },
    ],
    accessLabels: [
      {
        id: "access-1",
        label: "unclassified",
        confirmation: "pending",
        assignedBy: "system",
      },
    ],
    topicLabels: [{ id: "topic-1", label: "diary" }],
    ...overrides,
  };
}

async function insertAccountsAndSources(db: D1Client) {
  await db.insert(schema.accounts).values([{ id: "account-1" }, { id: "account-2" }]);
  await db.insert(schema.sourceRecords).values([
    { id: "source-1", accountId: "account-1", kind: "user_input" },
    { id: "source-2", accountId: "account-2", kind: "user_input" },
  ]);
}

describe("saveBrainItem", () => {
  it("日記など入力元に依存せずItem・Evidence・Labelをatomic保存する", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);

    await expect(saveBrainItem(db, createInput())).resolves.toEqual({
      type: "saved",
      brainItemId: "brain-1",
    });
    await expect(db.select().from(schema.brainItems)).resolves.toHaveLength(1);
    await expect(db.select().from(schema.brainItemEvidenceEdges)).resolves.toHaveLength(1);
    await expect(db.select().from(schema.brainItemAccessLabels)).resolves.toHaveLength(1);
    await expect(db.select().from(schema.brainItemTopicLabels)).resolves.toHaveLength(1);
  });

  it("EvidenceなしではBrain Itemを保存しない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);

    await expect(saveBrainItem(db, createInput({ evidence: [] }))).resolves.toEqual({
      type: "evidence-required",
    });
    await expect(db.select().from(schema.brainItems)).resolves.toHaveLength(0);
  });

  it("異なるAccountのSource Recordを拒否して何も保存しない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const input = createInput({
      evidence: [
        {
          id: "evidence-1",
          sourceRecordId: "source-2",
          relation: "supports",
          isDerivationTrigger: true,
          derivationMethod: "ai",
          generatedAt: new Date("2026-08-08T00:00:00Z"),
        },
      ],
    });

    await expect(saveBrainItem(db, input)).resolves.toEqual({
      type: "source-account-mismatch",
    });
    await expect(db.select().from(schema.brainItems)).resolves.toHaveLength(0);
  });
});
