import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import {
  type SaveBrainItemInput,
  claimDueBrainVectorSyncJobs,
  completeBrainVectorSyncJob,
  findActiveBrainVectorEntry,
  findBrainItemForAccount,
  getBrainVectorSyncTarget,
  listActiveBrainItems,
  loadBrainChatContextMemories,
  loadBrainSemanticDedupCandidates,
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
      attributes: { sourceKind: "diary", isInference: false },
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
    await expect(db.select().from(schema.brainVectorSyncJobs)).resolves.toEqual([
      expect.objectContaining({
        brainItemId: "brain-1",
        operation: "upsert",
        status: "pending",
      }),
    ]);
  });

  it("claim後に現在のactive Itemだけを返し、Vectorize受付を記録する", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    await db
      .update(schema.brainItems)
      .set({
        statement: "来月までに転職先を決めたい",
        attributes: {
          sourceKind: "diary",
          isInference: false,
          temporalContext: {
            originalStatement: "来月までに転職先を決めたい",
            anchorDate: "2026-08-10",
            timeZone: "Asia/Tokyo",
            resolutions: [{ original: "来月", resolved: "2026年9月" }],
          },
        },
        updatedAt: at,
      })
      .where(eq(schema.brainItems.id, "brain-1"));

    const jobs = await claimDueBrainVectorSyncJobs(db, at);
    expect(jobs).toEqual([
      { id: `brain-1:${at.getTime()}:upsert`, brainItemId: "brain-1", itemRevision: at.getTime() },
    ]);
    await expect(
      getBrainVectorSyncTarget(db, "account-1", jobs[0]?.id ?? "", "brain-1", at.getTime()),
    ).resolves.toEqual({
      action: "upsert",
      embeddingText: "来月までに転職先を決めたい\n時点情報: 来月 = 2026年9月",
      category: "preference",
      derivation: "ai",
      itemRevision: at.getTime(),
    });
    await expect(
      completeBrainVectorSyncJob(
        db,
        "account-1",
        jobs[0]?.id ?? "",
        { action: "upsert", vectorId: "vector-1", itemRevision: at.getTime() },
        "mutation-1",
        at,
      ),
    ).resolves.toBe(true);
    await expect(db.select().from(schema.brainVectorSyncJobs)).resolves.toEqual([
      expect.objectContaining({ status: "applied", mutationId: "mutation-1" }),
    ]);
    await expect(db.select().from(schema.brainVectorEntries)).resolves.toEqual([
      expect.objectContaining({
        id: "vector-1",
        brainItemId: "brain-1",
        itemRevision: at.getTime(),
      }),
    ]);
  });

  it("古いupsert jobでも処理時にinvalidatedならdeleteを返す", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    const [job] = await claimDueBrainVectorSyncJobs(db, at);
    await db
      .update(schema.brainItems)
      .set({ status: "invalidated", updatedAt: new Date(at.getTime() + 1) })
      .where(eq(schema.brainItems.id, "brain-1"));

    await expect(
      getBrainVectorSyncTarget(db, "account-1", job?.id ?? "", "brain-1", at.getTime()),
    ).resolves.toEqual({ action: "delete" });
  });

  it("upsert処理中にinvalidatedへ変わった場合はdelete jobを再度pendingにする", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    const invalidatedAt = new Date(at.getTime() + 1);
    const completedAt = new Date(at.getTime() + 2);
    await saveBrainItem(db, createInput({ at }));
    const [upsertJob] = await claimDueBrainVectorSyncJobs(db, at);
    await db.batch([
      db
        .update(schema.brainItems)
        .set({ status: "invalidated", updatedAt: invalidatedAt })
        .where(eq(schema.brainItems.id, "brain-1")),
      db.insert(schema.brainVectorSyncJobs).values({
        id: `brain-1:${invalidatedAt.getTime()}:delete`,
        brainItemId: "brain-1",
        itemRevision: invalidatedAt.getTime(),
        operation: "delete",
        status: "applied",
        mutationId: "earlier-delete",
        nextAttemptAt: invalidatedAt,
        createdAt: invalidatedAt,
        updatedAt: invalidatedAt,
      }),
    ]);

    await expect(
      completeBrainVectorSyncJob(
        db,
        "account-1",
        upsertJob?.id ?? "",
        { action: "upsert", vectorId: "late-vector", itemRevision: at.getTime() },
        "late-upsert",
        completedAt,
      ),
    ).resolves.toBe(true);

    await expect(
      db
        .select()
        .from(schema.brainVectorSyncJobs)
        .where(eq(schema.brainVectorSyncJobs.operation, "delete")),
    ).resolves.toEqual([expect.objectContaining({ status: "pending", mutationId: null })]);
    const [deleteJob] = await claimDueBrainVectorSyncJobs(db, completedAt);
    await expect(
      getBrainVectorSyncTarget(
        db,
        "account-1",
        deleteJob?.id ?? "",
        "brain-1",
        invalidatedAt.getTime(),
      ),
    ).resolves.toEqual({ action: "delete", vectorId: "late-vector" });
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

describe("loadBrainSemanticDedupCandidates", () => {
  it("Vector候補をAccountとactive状態で再認可し、比較用statementを返す", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    await db.insert(schema.brainVectorEntries).values({
      id: "vector-1",
      brainItemId: "brain-1",
      itemRevision: at.getTime(),
    });

    await expect(
      loadBrainSemanticDedupCandidates(db, "account-1", ["vector-1"], ["preference"]),
    ).resolves.toEqual([
      {
        brainItemId: "brain-1",
        category: "preference",
        statement: "日記から見える傾向",
        comparisonText: "日記から見える傾向",
        isInference: false,
      },
    ]);
  });
});

describe("loadBrainChatContextMemories", () => {
  it("Vectorize候補をAccountDataで再認可し、active ItemとEvidenceだけを類似度順で返す", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const firstObservedAt = new Date("2026-07-01T00:00:00Z");
    const lastObservedAt = new Date("2026-08-04T00:00:00Z");
    await db
      .update(schema.sourceRecords)
      .set({ createdAt: firstObservedAt, updatedAt: firstObservedAt })
      .where(eq(schema.sourceRecords.id, "source-1"));
    await db.insert(schema.sourceRecords).values({
      id: "source-2",
      accountId: "account-1",
      kind: "user_input",
      createdAt: lastObservedAt,
      updatedAt: lastObservedAt,
    });
    await db.insert(schema.sourceRecordTextPayloads).values({
      sourceRecordId: "source-1",
      body: "公園を歩くと気持ちが落ち着いた",
      contentHash: "hash-1",
    });
    await db.insert(schema.sourceRecordTextPayloads).values({
      sourceRecordId: "source-2",
      body: "今日も公園を歩くと落ち着いた",
      contentHash: "hash-2",
    });
    const recordedAt = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(
      db,
      createInput({
        at: recordedAt,
        evidence: [
          ...createInput().evidence,
          {
            id: "evidence-2",
            sourceRecordId: "source-2",
            relation: "supports",
            isDerivationTrigger: false,
            derivationMethod: "ai",
            generatedAt: recordedAt,
          },
        ],
      }),
    );
    await saveBrainItem(
      db,
      createInput({
        at: recordedAt,
        item: {
          ...createInput().item,
          id: "brain-expired",
          statement: "以前は夜更かしが好きだった",
          validTo: new Date("2026-08-10T12:00:00Z"),
        },
        evidence: [
          {
            id: "evidence-expired",
            sourceRecordId: "source-1",
            relation: "supports",
            isDerivationTrigger: true,
            derivationMethod: "ai",
            generatedAt: recordedAt,
          },
        ],
        accessLabels: [{ id: "access-expired", label: "private", assignedBy: "system" }],
        topicLabels: [],
      }),
    );
    await db.insert(schema.brainVectorEntries).values([
      {
        id: "vector-expired",
        brainItemId: "brain-expired",
        itemRevision: recordedAt.getTime(),
        createdAt: recordedAt,
        updatedAt: recordedAt,
      },
      {
        id: "vector-active",
        brainItemId: "brain-1",
        itemRevision: recordedAt.getTime(),
        createdAt: recordedAt,
        updatedAt: recordedAt,
      },
    ]);

    await expect(
      loadBrainChatContextMemories(
        db,
        "account-1",
        ["vector-expired", "foreign-vector", "vector-active", "vector-active"],
        new Date("2026-08-11T00:00:00Z"),
      ),
    ).resolves.toEqual([
      {
        brainItemId: "brain-1",
        category: "preference",
        statement: "日記から見える傾向",
        derivation: "ai",
        isInference: false,
        status: "active",
        confidence: { state: "uncomputed" },
        accessLabels: ["unclassified"],
        firstObservedAt,
        lastObservedAt,
        evidence: [
          {
            sourceRecordId: "source-2",
            text: "今日も公園を歩くと落ち着いた",
            recordedAt: lastObservedAt,
          },
          {
            sourceRecordId: "source-1",
            text: "公園を歩くと気持ちが落ち着いた",
            recordedAt: firstObservedAt,
          },
        ],
      },
    ]);
  });

  it("複数Brain ItemでもEvidence原文をContext全体で3件までにする", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const recordedAt = new Date("2026-08-10T00:00:00Z");
    for (const index of [1, 2, 3, 4]) {
      const sourceRecordId = `source-${index}`;
      if (index > 1) {
        await db.insert(schema.sourceRecords).values({
          id: sourceRecordId,
          accountId: "account-1",
          kind: "user_input",
        });
      }
      await db.insert(schema.sourceRecordTextPayloads).values({
        sourceRecordId,
        body: `Evidence ${index}`,
        contentHash: `hash-${index}`,
      });
    }
    const evidence = (brainItemId: string, indexes: readonly number[]) =>
      indexes.map((index) => ({
        id: `${brainItemId}-evidence-${index}`,
        sourceRecordId: `source-${index}`,
        relation: "supports" as const,
        isDerivationTrigger: true,
        derivationMethod: "ai" as const,
        generatedAt: new Date(recordedAt.getTime() + index),
      }));
    await saveBrainItem(db, createInput({ at: recordedAt, evidence: evidence("brain-1", [1, 2]) }));
    await saveBrainItem(
      db,
      createInput({
        at: recordedAt,
        item: { ...createInput().item, id: "brain-2", statement: "別の記憶" },
        evidence: evidence("brain-2", [3, 4]),
        accessLabels: [{ id: "brain-2-access", label: "unclassified", assignedBy: "system" }],
        topicLabels: [],
      }),
    );
    await db.insert(schema.brainVectorEntries).values([
      {
        id: "vector-1",
        brainItemId: "brain-1",
        itemRevision: recordedAt.getTime(),
        createdAt: recordedAt,
        updatedAt: recordedAt,
      },
      {
        id: "vector-2",
        brainItemId: "brain-2",
        itemRevision: recordedAt.getTime(),
        createdAt: recordedAt,
        updatedAt: recordedAt,
      },
    ]);

    const memories = await loadBrainChatContextMemories(db, "account-1", ["vector-1", "vector-2"]);

    expect(memories).toHaveLength(2);
    expect(memories.flatMap(({ evidence: itemEvidence }) => itemEvidence)).toHaveLength(3);
    expect(memories.map(({ evidence: itemEvidence }) => itemEvidence.length)).toEqual([2, 1]);
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

describe("findActiveBrainVectorEntry", () => {
  it("本人のactive Itemに対応するentryだけを返す", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    const [job] = await claimDueBrainVectorSyncJobs(db, at);
    await completeBrainVectorSyncJob(
      db,
      "account-1",
      job?.id ?? "",
      { action: "upsert", vectorId: "private-vector-id", itemRevision: at.getTime() },
      "mutation-1",
      at,
    );

    await expect(findActiveBrainVectorEntry(db, "account-1", "brain-1")).resolves.toEqual({
      vectorId: "private-vector-id",
      itemRevision: at.getTime(),
    });
    await expect(findActiveBrainVectorEntry(db, "account-2", "brain-1")).resolves.toBeUndefined();

    await db
      .update(schema.brainItems)
      .set({ status: "invalidated" })
      .where(eq(schema.brainItems.id, "brain-1"));
    await expect(findActiveBrainVectorEntry(db, "account-1", "brain-1")).resolves.toBeUndefined();
  });
});

describe("listActiveBrainItems", () => {
  it("本人のactive Itemを最後に確認した日時順で返し、最初と最後の確認日時を導出する", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const firstObservedAt = new Date("2026-07-01T00:00:00Z");
    const newerItemObservedAt = new Date("2026-08-04T00:00:00Z");
    const lastObservedAt = new Date("2026-08-11T00:00:00Z");
    await db
      .update(schema.sourceRecords)
      .set({ createdAt: firstObservedAt, updatedAt: firstObservedAt })
      .where(eq(schema.sourceRecords.id, "source-1"));
    await db.insert(schema.sourceRecords).values([
      {
        id: "source-2",
        accountId: "account-1",
        kind: "user_input",
        createdAt: newerItemObservedAt,
        updatedAt: newerItemObservedAt,
      },
      {
        id: "source-3",
        accountId: "account-1",
        kind: "user_input",
        createdAt: lastObservedAt,
        updatedAt: lastObservedAt,
      },
    ]);
    await saveBrainItem(
      db,
      createInput({
        at: new Date("2026-08-08T00:00:00Z"),
        item: { ...createInput().item, id: "older-active", statement: "古い記憶" },
        evidence: [
          {
            id: "older-first-evidence",
            sourceRecordId: "source-1",
            relation: "supports",
            isDerivationTrigger: true,
            derivationMethod: "ai",
            generatedAt: firstObservedAt,
          },
          {
            id: "older-last-evidence",
            sourceRecordId: "source-3",
            relation: "supports",
            isDerivationTrigger: false,
            derivationMethod: "ai",
            generatedAt: lastObservedAt,
          },
        ],
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
            sourceRecordId: "source-2",
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
          id: "older-active",
          statement: "古い記憶",
          status: "active",
          firstObservedAt,
          lastObservedAt,
          vectorSync: expect.objectContaining({
            status: "pending",
            operation: "upsert",
            attemptCount: 0,
            hasEntry: false,
          }),
          evidence: [
            expect.objectContaining({ sourceRecordId: "source-1", recordedAt: firstObservedAt }),
            expect.objectContaining({ sourceRecordId: "source-3", recordedAt: lastObservedAt }),
          ],
        }),
        expect.objectContaining({
          id: "newer-active",
          statement: "新しい記憶",
          firstObservedAt: newerItemObservedAt,
          lastObservedAt: newerItemObservedAt,
        }),
      ],
      truncated: false,
    });
  });
});
