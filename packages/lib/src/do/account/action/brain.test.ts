import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import {
  type SaveBrainItemInput,
  findBrainItemForAccount,
  listActiveBrainItems,
  saveBrainItem,
} from "./brain";

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

async function insertAccountsAndSources(db: AccountDataDatabase) {
  await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
  await db.insert(schema.sourceRecords).values({
    id: "source-1",
    accountId: "account-1",
    kind: "user_input",
  });
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

  it("同じObjectに存在しないSource Recordを拒否して何も保存しない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const input = createInput({
      evidence: [
        {
          id: "evidence-1",
          sourceRecordId: "source-missing",
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
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
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
      findBrainItemForAccount(db, { accountId: "account-unknown", brainItemId: "brain-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("listActiveBrainItems", () => {
  it("本人のactive ItemとEvidenceだけを新しい順で返す", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    await saveBrainItem(
      db,
      createInput({
        at: new Date("2026-08-08T00:00:00Z"),
        item: { ...createInput().item, id: "older-active", statement: "古い記憶" },
      }),
    );
    await saveBrainItem(
      db,
      createInput({
        at: new Date("2026-08-09T00:00:00Z"),
        item: { ...createInput().item, id: "newer-active", statement: "新しい記憶" },
        evidence: [
          {
            id: "newer-evidence",
            sourceRecordId: "source-1",
            relation: "supports",
            isDerivationTrigger: true,
            derivationMethod: "ai",
            generatedAt: new Date("2026-08-09T00:00:00Z"),
          },
        ],
        accessLabels: [{ id: "newer-access", label: "unclassified", assignedBy: "system" }],
        topicLabels: [{ id: "newer-topic", label: "diary" }],
      }),
    );
    await db.insert(schema.brainItems).values({
      ...createInput().item,
      id: "invalidated",
      statement: "無効な記憶",
      status: "invalidated",
    });

    await expect(listActiveBrainItems(db, "account-1")).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "newer-active",
          statement: "新しい記憶",
          status: "active",
          evidence: [expect.objectContaining({ sourceRecordId: "source-1", relation: "supports" })],
        }),
        expect.objectContaining({ id: "older-active", statement: "古い記憶" }),
      ],
      truncated: false,
    });
  });
});
