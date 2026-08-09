import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import {
  type SaveBrainItemInput,
  findBrainItemForAccount,
  findProfileSummaryDiaryData,
  saveBrainItem,
} from "./brain";

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

describe("findBrainItemForAccount", () => {
  it("認証済みAccountに属するBrain Itemだけを返す", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values([{ id: "account-1" }, { id: "account-2" }]);
    await db.insert(schema.brainItems).values({
      id: "brain-1",
      accountId: "account-1",
      category: "preference",
      statement: "Account 1だけの命題",
      attributes: {},
      derivation: "deterministic",
      status: "active",
      stability: "changeable",
      sensitivity: "normal",
      externallyShareable: false,
      confidence: { state: "uncomputed" },
    });

    await expect(
      findBrainItemForAccount(db, { accountId: "account-1", brainItemId: "brain-1" }),
    ).resolves.toMatchObject({ id: "brain-1", accountId: "account-1" });
    await expect(
      findBrainItemForAccount(db, { accountId: "account-2", brainItemId: "brain-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("findProfileSummaryDiaryData", () => {
  it("本人のactiveな日記Memoryだけを新しい順で最大3件返す", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values([{ id: "account-1" }, { id: "account-2" }]);
    await db.insert(schema.sourceRecords).values([
      { id: "source-1", accountId: "account-1", kind: "user_input" },
      { id: "source-2", accountId: "account-1", kind: "user_input" },
      { id: "source-3", accountId: "account-1", kind: "user_input" },
      { id: "source-4", accountId: "account-1", kind: "user_input" },
      { id: "source-other", accountId: "account-2", kind: "user_input" },
    ]);
    const dates = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"];
    await db.insert(schema.brainItems).values([
      ...dates.map((date, index) => ({
        id: `memory-${index + 1}`,
        accountId: "account-1",
        category: "memory",
        statement: `日記の出来事${index + 1}`,
        attributes: { sourceKind: "diary" },
        derivation: "ai" as const,
        status: "active" as const,
        validFrom: new Date(`${date}T00:00:00Z`),
        stability: "stable" as const,
        sensitivity: "normal",
        externallyShareable: false,
        confidence: { state: "uncomputed" },
      })),
      {
        id: "memory-other",
        accountId: "account-2",
        category: "memory",
        statement: "別Accountの日記",
        attributes: { sourceKind: "diary" },
        derivation: "ai",
        status: "active",
        validFrom: new Date("2026-08-05T00:00:00Z"),
        stability: "stable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: { state: "uncomputed" },
      },
    ]);
    await db.insert(schema.brainItemTopicLabels).values([
      ...dates.map((_date, index) => ({
        id: `topic-${index + 1}`,
        accountId: "account-1",
        brainItemId: `memory-${index + 1}`,
        label: "diary",
      })),
      {
        id: "topic-other",
        accountId: "account-2",
        brainItemId: "memory-other",
        label: "diary",
      },
    ]);
    await db.insert(schema.brainItemEvidenceEdges).values([
      ...dates.map((_date, index) => ({
        id: `evidence-${index + 1}`,
        accountId: "account-1",
        brainItemId: `memory-${index + 1}`,
        sourceRecordId: `source-${index + 1}`,
        relation: "supports" as const,
        isDerivationTrigger: true,
        derivationMethod: "ai" as const,
        generatedAt: new Date("2026-08-09T00:00:00Z"),
      })),
      {
        id: "evidence-4-extra",
        accountId: "account-1",
        brainItemId: "memory-4",
        sourceRecordId: "source-3",
        relation: "supports",
        isDerivationTrigger: true,
        derivationMethod: "ai",
        generatedAt: new Date("2026-08-09T00:00:00Z"),
      },
      {
        id: "evidence-other",
        accountId: "account-2",
        brainItemId: "memory-other",
        sourceRecordId: "source-other",
        relation: "supports",
        isDerivationTrigger: true,
        derivationMethod: "ai",
        generatedAt: new Date("2026-08-09T00:00:00Z"),
      },
    ]);

    await expect(findProfileSummaryDiaryData(db, "account-1")).resolves.toEqual({
      memories: [
        {
          id: "memory-4",
          statement: "日記の出来事4",
          recordedAt: "2026-08-04T00:00:00.000Z",
          evidenceCount: 2,
        },
        expect.objectContaining({ id: "memory-3", evidenceCount: 1 }),
        expect.objectContaining({ id: "memory-2", evidenceCount: 1 }),
      ],
      memoryCount: 4,
    });
  });
});
