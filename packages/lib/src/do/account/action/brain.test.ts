import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import type { PromptContext } from "../prompt-context";
import {
  type SaveBrainItemInput,
  claimDueBrainVectorSyncJobs,
  completeBrainVectorSyncJob,
  failBrainVectorSyncJob,
  findActiveBrainVectorEntry,
  findBrainItemForAccount,
  getBrainVectorSyncTarget,
  listActiveBrainItems,
  listActivePromptContextKinds,
  listFailedBrainVectorSyncJobs,
  loadBrainChatContextMemories,
  loadBrainSemanticDedupCandidates,
  loadRelationshipDiagnosisContexts,
  readPersonalDataFeatureExport,
  resetAllFailedBrainVectorSyncJobs,
  resetFailedBrainVectorSyncJob,
  saveBrainItem,
  selectDailyPromptStrategyPreference,
  selectDailyPromptTimePreference,
  selectDailyPromptWeekdayContext,
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

async function savePromptContextFixture(
  db: AccountDataDatabase,
  input: Readonly<{
    suffix: string;
    category: string;
    promptContext: PromptContext;
    isInference?: boolean;
    at?: Date;
  }>,
) {
  const at = input.at ?? new Date("2026-08-10T00:00:00Z");
  const sourceRecordId = `source-${input.suffix}`;
  await db.insert(schema.sourceRecords).values({
    id: sourceRecordId,
    accountId: "account-1",
    kind: "user_input",
    createdAt: at,
    updatedAt: at,
  });
  const base = createInput();
  return await saveBrainItem(db, {
    at,
    item: {
      ...base.item,
      id: `brain-${input.suffix}`,
      category: input.category,
      statement: `声かけ属性 ${input.suffix}`,
      attributes: {
        sourceKind: "diary",
        isInference: input.isInference ?? false,
        promptContext: input.promptContext,
      },
    },
    evidence: [
      {
        id: `evidence-${input.suffix}`,
        sourceRecordId,
        relation: "supports",
        isDerivationTrigger: true,
        derivationMethod: "ai",
        generatedAt: at,
      },
    ],
    accessLabels: [{ id: `access-${input.suffix}`, label: "unclassified", assignedBy: "system" }],
    topicLabels: [{ id: `topic-${input.suffix}`, label: "diary" }],
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

    const { jobs } = await claimDueBrainVectorSyncJobs(db, at);
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

  it("失敗ごとに待機時間を増やし、6回目の失敗で終端化して以後claimしない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    let claimAt = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at: claimAt }));
    const retryDelays = [60, 2 * 60, 8 * 60, 30 * 60, 2 * 60 * 60].map((seconds) => seconds * 1000);

    for (const [index, retryDelay] of retryDelays.entries()) {
      const { jobs } = await claimDueBrainVectorSyncJobs(db, claimAt);
      expect(jobs).toHaveLength(1);
      const failedAt = new Date(claimAt.getTime() + 1_000);
      const result = await failBrainVectorSyncJob(
        db,
        jobs[0]?.id ?? "",
        "BRAIN_VECTOR_SYNC_FAILED",
        true,
        failedAt,
      );
      const nextAttemptAt = new Date(failedAt.getTime() + retryDelay);
      expect(result).toEqual({
        outcome: "retry-scheduled",
        attemptCount: index + 1,
        nextAttemptAt,
      });
      expect(
        db
          .select({
            status: schema.brainVectorSyncJobs.status,
            attemptCount: schema.brainVectorSyncJobs.attemptCount,
            nextAttemptAt: schema.brainVectorSyncJobs.nextAttemptAt,
          })
          .from(schema.brainVectorSyncJobs)
          .get(),
      ).toEqual({
        status: "retry_scheduled",
        attemptCount: index + 1,
        nextAttemptAt,
      });
      await expect(
        claimDueBrainVectorSyncJobs(db, new Date(nextAttemptAt.getTime() - 1)),
      ).resolves.toEqual({ jobs: [], terminalFailures: [] });
      claimAt = nextAttemptAt;
    }

    const { jobs: finalJobs } = await claimDueBrainVectorSyncJobs(db, claimAt);
    const finalResult = await failBrainVectorSyncJob(
      db,
      finalJobs[0]?.id ?? "",
      "BRAIN_VECTOR_SYNC_FAILED",
      true,
      claimAt,
    );
    expect(finalResult).toEqual({ outcome: "failed", attemptCount: 6 });
    expect(
      db
        .select({ status: schema.brainVectorSyncJobs.status })
        .from(schema.brainVectorSyncJobs)
        .get(),
    ).toEqual({ status: "failed" });
    await expect(
      claimDueBrainVectorSyncJobs(db, new Date("2027-08-10T00:00:00Z")),
    ).resolves.toEqual({ jobs: [], terminalFailures: [] });
  });

  it("非一時エラーを即時終端化し、明示的なreset後だけ再開する", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    const { jobs } = await claimDueBrainVectorSyncJobs(db, at);

    await expect(
      failBrainVectorSyncJob(
        db,
        jobs[0]?.id ?? "",
        "BRAIN_VECTOR_HMAC_SECRET_NOT_CONFIGURED",
        false,
        at,
      ),
    ).resolves.toEqual({ outcome: "failed", attemptCount: 1 });
    await expect(claimDueBrainVectorSyncJobs(db, at)).resolves.toEqual({
      jobs: [],
      terminalFailures: [],
    });
    const failedList = await listActiveBrainItems(db, "account-1");
    expect(failedList.items[0]?.vectorSync).toMatchObject({
      status: "failed",
      attemptCount: 1,
      failureCode: "BRAIN_VECTOR_HMAC_SECRET_NOT_CONFIGURED",
    });
    expect(failedList.items[0]?.vectorSync).not.toHaveProperty("nextAttemptAt");

    await expect(resetFailedBrainVectorSyncJob(db, jobs[0]?.id ?? "", at)).resolves.toBe(true);
    await expect(claimDueBrainVectorSyncJobs(db, at)).resolves.toEqual({
      jobs,
      terminalFailures: [],
    });
    expect(
      db
        .select({ attemptCount: schema.brainVectorSyncJobs.attemptCount })
        .from(schema.brainVectorSyncJobs)
        .get(),
    ).toEqual({ attemptCount: 1 });
  });

  it("Account内の終端jobを一覧し、一括reset後にすべて再claimする", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    const secondInputBase = createInput();
    const secondEvidence = secondInputBase.evidence[0];
    const secondAccessLabel = secondInputBase.accessLabels[0];
    if (!secondEvidence || !secondAccessLabel)
      throw new Error("Brain Item test fixture is invalid");
    await saveBrainItem(
      db,
      createInput({
        at,
        item: { ...secondInputBase.item, id: "brain-2" },
        evidence: [{ ...secondEvidence, id: "evidence-2" }],
        accessLabels: [{ ...secondAccessLabel, id: "access-2" }],
        topicLabels: [{ id: "topic-2", label: "diary" }],
      }),
    );
    const { jobs } = await claimDueBrainVectorSyncJobs(db, at);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      await failBrainVectorSyncJob(
        db,
        job.id,
        "BRAIN_VECTOR_HMAC_SECRET_NOT_CONFIGURED",
        false,
        at,
      );
    }

    await expect(listFailedBrainVectorSyncJobs(db)).resolves.toEqual({
      jobs: [
        {
          jobId: `brain-1:${at.getTime()}:upsert`,
          brainItemId: "brain-1",
          itemRevision: at.getTime(),
          operation: "upsert",
          attemptCount: 1,
          failureCode: "BRAIN_VECTOR_HMAC_SECRET_NOT_CONFIGURED",
          failedAt: at,
        },
        {
          jobId: `brain-2:${at.getTime()}:upsert`,
          brainItemId: "brain-2",
          itemRevision: at.getTime(),
          operation: "upsert",
          attemptCount: 1,
          failureCode: "BRAIN_VECTOR_HMAC_SECRET_NOT_CONFIGURED",
          failedAt: at,
        },
      ],
      truncated: false,
    });
    await expect(resetAllFailedBrainVectorSyncJobs(db, at)).resolves.toBe(2);
    await expect(claimDueBrainVectorSyncJobs(db, at)).resolves.toEqual({
      jobs,
      terminalFailures: [],
    });
  });

  it("終端job一覧を新しい順の100件に制限する", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    await db
      .update(schema.brainVectorSyncJobs)
      .set({ status: "failed", failureCode: "BRAIN_VECTOR_SYNC_FAILED", updatedAt: at })
      .where(eq(schema.brainVectorSyncJobs.brainItemId, "brain-1"));
    await db.insert(schema.brainVectorSyncJobs).values(
      Array.from({ length: 100 }, (_, index) => {
        const itemRevision = at.getTime() + (index + 1) * 1_000;
        const failedAt = new Date(itemRevision);
        return {
          id: `brain-1:${itemRevision}:upsert`,
          brainItemId: "brain-1",
          itemRevision,
          operation: "upsert" as const,
          status: "failed" as const,
          attemptCount: 6,
          nextAttemptAt: failedAt,
          failureCode: "BRAIN_VECTOR_SYNC_ATTEMPTS_EXHAUSTED",
          createdAt: failedAt,
          updatedAt: failedAt,
        };
      }),
    );

    const result = await listFailedBrainVectorSyncJobs(db);

    expect(result.truncated).toBe(true);
    expect(result.jobs).toHaveLength(100);
    expect(result.jobs[0]?.itemRevision).toBe(at.getTime() + 100_000);
    expect(result.jobs.at(-1)?.itemRevision).toBe(at.getTime() + 1_000);
  });

  it("終端jobの一括resetを25件に制限し、複数回で収束させる", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    await db
      .update(schema.brainVectorSyncJobs)
      .set({ status: "failed", failureCode: "BRAIN_VECTOR_SYNC_FAILED", updatedAt: at })
      .where(eq(schema.brainVectorSyncJobs.brainItemId, "brain-1"));
    await db.insert(schema.brainVectorSyncJobs).values(
      Array.from({ length: 29 }, (_, index) => {
        const itemRevision = at.getTime() + (index + 1) * 1_000;
        return {
          id: `brain-1:${itemRevision}:upsert`,
          brainItemId: "brain-1",
          itemRevision,
          operation: "upsert" as const,
          status: "failed" as const,
          attemptCount: 6,
          nextAttemptAt: new Date(itemRevision),
          failureCode: "BRAIN_VECTOR_SYNC_ATTEMPTS_EXHAUSTED",
          createdAt: new Date(itemRevision),
          updatedAt: new Date(itemRevision),
        };
      }),
    );

    await expect(resetAllFailedBrainVectorSyncJobs(db, at)).resolves.toBe(25);
    const remainingAfterFirstReset = await db
      .select()
      .from(schema.brainVectorSyncJobs)
      .where(eq(schema.brainVectorSyncJobs.status, "failed"));
    expect(remainingAfterFirstReset).toHaveLength(5);
    await expect(resetAllFailedBrainVectorSyncJobs(db, at)).resolves.toBe(5);
    await expect(resetAllFailedBrainVectorSyncJobs(db, at)).resolves.toBe(0);
  });

  it("最終dispatchのlease期限切れを終端化して以後claimしない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    await db
      .update(schema.brainVectorSyncJobs)
      .set({ status: "submitted", attemptCount: 6, nextAttemptAt: at })
      .where(eq(schema.brainVectorSyncJobs.brainItemId, "brain-1"));

    await expect(claimDueBrainVectorSyncJobs(db, at)).resolves.toEqual({
      jobs: [],
      terminalFailures: [
        {
          jobId: `brain-1:${at.getTime()}:upsert`,
          brainItemId: "brain-1",
          attemptCount: 6,
          failureCode: "BRAIN_VECTOR_SYNC_ATTEMPTS_EXHAUSTED",
        },
      ],
    });
    expect(
      db
        .select({ status: schema.brainVectorSyncJobs.status })
        .from(schema.brainVectorSyncJobs)
        .get(),
    ).toEqual({ status: "failed" });
    await expect(claimDueBrainVectorSyncJobs(db, at)).resolves.toEqual({
      jobs: [],
      terminalFailures: [],
    });
  });

  it("古いupsert jobでも処理時にinvalidatedならdeleteを返す", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await saveBrainItem(db, createInput({ at }));
    const {
      jobs: [job],
    } = await claimDueBrainVectorSyncJobs(db, at);
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
    const {
      jobs: [upsertJob],
    } = await claimDueBrainVectorSyncJobs(db, at);
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
        attemptCount: 4,
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
    ).resolves.toEqual([
      expect.objectContaining({ status: "pending", attemptCount: 0, mutationId: null }),
    ]);
    const {
      jobs: [deleteJob],
    } = await claimDueBrainVectorSyncJobs(db, completedAt);
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

describe("loadRelationshipDiagnosisContexts", () => {
  it("本人が所有する現在有効な診断projectionだけを最小Contextで返す", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
    const at = new Date("2026-08-15T00:00:00Z");
    await db.insert(schema.diagnosisScoringConfigs).values({
      id: "relationship-scoring",
      version: 1,
      definition: {},
    });
    await db.insert(schema.diagnoses).values([
      {
        id: "work-style",
        title: "仕事の関係性",
        relationshipCategory: "work",
        scoringConfigId: "relationship-scoring",
        opensAt: at,
        state: "published",
      },
      {
        id: "friend-style",
        title: "友人との関係性",
        relationshipCategory: "friend",
        scoringConfigId: "relationship-scoring",
        opensAt: at,
        state: "published",
      },
    ]);
    await db.insert(schema.brainItems).values([
      {
        id: "work-brain",
        accountId: "account-1",
        category: "preference",
        statement: "結論を整理してから話す傾向がある",
        attributes: {},
        derivation: "deterministic",
        status: "active",
        stability: "changeable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: {},
      },
      {
        id: "deleted-brain",
        accountId: "account-1",
        category: "preference",
        statement: "削除済みの傾向",
        attributes: {},
        derivation: "deterministic",
        status: "active",
        stability: "changeable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: {},
        isDeleted: true,
        deletedAt: at,
      },
    ]);
    await db.insert(schema.diagnosisBrainProjectionHeads).values([
      {
        id: "work-head",
        accountId: "account-1",
        diagnosisId: "work-style",
        scoringConfigId: "relationship-scoring",
        scoringConfigVersion: 1,
        parameterId: "planning",
        currentBrainItemId: "work-brain",
        contentSignature: "work",
      },
      {
        id: "friend-head",
        accountId: "account-1",
        diagnosisId: "friend-style",
        scoringConfigId: "relationship-scoring",
        scoringConfigVersion: 1,
        parameterId: "planning",
        currentBrainItemId: "deleted-brain",
        contentSignature: "friend",
      },
    ]);

    await expect(loadRelationshipDiagnosisContexts(db, "account-1", at)).resolves.toEqual([
      {
        ownerAccountId: "account-1",
        diagnosisId: "work-style",
        relationshipCategory: "work",
        statement: "結論を整理してから話す傾向がある",
      },
    ]);
  });
});

describe("listActivePromptContextKinds", () => {
  it("activeで根拠とAccess Labelが有効な声かけ属性だけをマスタ順で返す", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    const input = createInput({
      at,
      item: {
        ...createInput().item,
        category: "identity",
        statement: "看護師として働いている",
        attributes: {
          sourceKind: "diary",
          isInference: false,
          promptContext: { kind: "occupation", occupation: "看護師" },
        },
      },
    });
    await saveBrainItem(db, input);

    await expect(listActivePromptContextKinds(db, "account-1", at)).resolves.toEqual([
      "occupation",
    ]);
    await db
      .update(schema.brainItemAccessLabels)
      .set({ isDeleted: true, deletedAt: at, updatedAt: at })
      .where(eq(schema.brainItemAccessLabels.id, "access-1"));
    await expect(listActivePromptContextKinds(db, "account-1", at)).resolves.toEqual([]);
  });
});

describe("selectDailyPromptWeekdayContext", () => {
  it("同じ曜日では定期予定を週間リズムより優先し、予定名を返さない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T09:00:00Z");
    await savePromptContextFixture(db, {
      suffix: "day-off",
      category: "behavior_pattern",
      promptContext: {
        kind: "weekly_rhythm",
        scheduleMode: "fixed_weekly",
        daysOff: ["monday"],
      },
      at,
    });
    await savePromptContextFixture(db, {
      suffix: "lesson",
      category: "behavior_pattern",
      promptContext: {
        kind: "recurring_schedule",
        activity: "英会話教室",
        weekdays: ["monday"],
      },
      at,
    });

    await expect(selectDailyPromptWeekdayContext(db, "account-1", "monday", at)).resolves.toBe(
      "recurring_schedule",
    );
    await expect(
      selectDailyPromptWeekdayContext(db, "account-1", "tuesday", at),
    ).resolves.toBeUndefined();
  });

  it.each([
    [
      "固定休",
      {
        kind: "weekly_rhythm",
        scheduleMode: "fixed_weekly",
        daysOff: ["monday"],
      },
      "day_off",
    ],
    [
      "固定活動日",
      {
        kind: "weekly_rhythm",
        scheduleMode: "fixed_weekly",
        activeWeekdays: ["monday"],
      },
      "active_day",
    ],
    ["変動シフト", { kind: "weekly_rhythm", scheduleMode: "variable_shift" }, undefined],
  ] satisfies ReadonlyArray<readonly [string, PromptContext, string | undefined]>)(
    "%sを安全な曜日区分へ変換する",
    async (_name, promptContext, expected) => {
      const db = createTestDb();
      await insertAccountsAndSources(db);
      const at = new Date("2026-08-10T09:00:00Z");
      await savePromptContextFixture(db, {
        suffix: "rhythm",
        category: "behavior_pattern",
        promptContext,
        at,
      });

      await expect(selectDailyPromptWeekdayContext(db, "account-1", "monday", at)).resolves.toBe(
        expected,
      );
    },
  );

  it("推定、分類不一致、無効なAccess Labelを個別化へ使わない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T09:00:00Z");
    await savePromptContextFixture(db, {
      suffix: "inferred",
      category: "behavior_pattern",
      promptContext: {
        kind: "recurring_schedule",
        activity: "習い事",
        weekdays: ["monday"],
      },
      isInference: true,
      at,
    });
    await savePromptContextFixture(db, {
      suffix: "wrong-category",
      category: "identity",
      promptContext: {
        kind: "recurring_schedule",
        activity: "習い事",
        weekdays: ["monday"],
      },
      at,
    });
    await savePromptContextFixture(db, {
      suffix: "deleted-access",
      category: "behavior_pattern",
      promptContext: {
        kind: "weekly_rhythm",
        scheduleMode: "fixed_weekly",
        daysOff: ["monday"],
      },
      at,
    });
    await db
      .update(schema.brainItemAccessLabels)
      .set({ isDeleted: true, deletedAt: at, updatedAt: at })
      .where(eq(schema.brainItemAccessLabels.id, "access-deleted-access"));

    await expect(
      selectDailyPromptWeekdayContext(db, "account-1", "monday", at),
    ).resolves.toBeUndefined();
  });

  it("有効期間外、旧版、根拠削除済みの属性を個別化へ使わない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T09:00:00Z");
    await savePromptContextFixture(db, {
      suffix: "lifecycle",
      category: "behavior_pattern",
      promptContext: {
        kind: "recurring_schedule",
        activity: "習い事",
        weekdays: ["monday"],
      },
      at,
    });

    await db
      .update(schema.brainItems)
      .set({ validFrom: new Date(at.getTime() + 1_000), updatedAt: at })
      .where(eq(schema.brainItems.id, "brain-lifecycle"));
    await expect(
      selectDailyPromptWeekdayContext(db, "account-1", "monday", at),
    ).resolves.toBeUndefined();

    await db
      .update(schema.brainItems)
      .set({ validFrom: null, status: "superseded", updatedAt: at })
      .where(eq(schema.brainItems.id, "brain-lifecycle"));
    await expect(
      selectDailyPromptWeekdayContext(db, "account-1", "monday", at),
    ).resolves.toBeUndefined();

    await db
      .update(schema.brainItems)
      .set({ status: "active", updatedAt: at })
      .where(eq(schema.brainItems.id, "brain-lifecycle"));
    await db
      .update(schema.sourceRecords)
      .set({ isDeleted: true, deletedAt: at, updatedAt: at })
      .where(eq(schema.sourceRecords.id, "source-lifecycle"));
    await expect(
      selectDailyPromptWeekdayContext(db, "account-1", "monday", at),
    ).resolves.toBeUndefined();
  });
});

describe("selectDailyPromptStrategyPreference", () => {
  it.each([
    ["brief", "brief"],
    ["event_first", "event_first"],
    ["feeling_first", "feeling_first"],
    ["no_choices", "standard"],
  ] as const)("明言された%sをレビュー済み方針%sへ変換する", async (style, expected) => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T09:00:00Z");
    await savePromptContextFixture(db, {
      suffix: style,
      category: "preference",
      promptContext: { kind: "question_style", style },
      at,
    });

    await expect(selectDailyPromptStrategyPreference(db, "account-1", at)).resolves.toBe(expected);
  });

  it("推定、分類不一致、削除済み根拠を方針選択へ使わない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T09:00:00Z");
    await savePromptContextFixture(db, {
      suffix: "inferred-style",
      category: "preference",
      promptContext: { kind: "question_style", style: "brief" },
      isInference: true,
      at,
    });
    await savePromptContextFixture(db, {
      suffix: "wrong-style-category",
      category: "identity",
      promptContext: { kind: "question_style", style: "event_first" },
      at,
    });
    await savePromptContextFixture(db, {
      suffix: "deleted-style-source",
      category: "preference",
      promptContext: { kind: "question_style", style: "feeling_first" },
      at,
    });
    await db
      .update(schema.sourceRecords)
      .set({ isDeleted: true, deletedAt: at, updatedAt: at })
      .where(eq(schema.sourceRecords.id, "source-deleted-style-source"));

    await expect(selectDailyPromptStrategyPreference(db, "account-1", at)).resolves.toBeUndefined();
  });
});

describe("selectDailyPromptTimePreference", () => {
  it.each([
    ["after_returning_home", undefined, 20],
    ["after_dinner", undefined, 21],
    ["fixed_time", "20:30", 20],
    ["variable", undefined, 18],
  ] as const)("明言された%sを候補時刻へ変換する", async (window, localTime, expected) => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T09:00:00Z");
    await savePromptContextFixture(db, {
      suffix: `time-${window}`,
      category: "preference",
      promptContext: {
        kind: "rest_window",
        window,
        ...(localTime ? { localTime } : {}),
      },
      at,
    });

    await expect(selectDailyPromptTimePreference(db, "account-1", at)).resolves.toBe(expected);
  });

  it("推定された一息つきやすい時間を配送時刻へ使わない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T09:00:00Z");
    await savePromptContextFixture(db, {
      suffix: "inferred-time",
      category: "preference",
      promptContext: { kind: "rest_window", window: "after_dinner" },
      isInference: true,
      at,
    });

    await expect(selectDailyPromptTimePreference(db, "account-1", at)).resolves.toBeUndefined();
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

  it("Vector候補が上限まであってもVector同期前の直近Itemを比較候補へ残す", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
    const vectorItems = Array.from({ length: 30 }, (_, index) => ({
      ...createInput().item,
      id: `brain-vector-${index}`,
      statement: `Vector候補 ${index}`,
      createdAt: new Date(`2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
      updatedAt: new Date(`2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
    }));
    await db.insert(schema.brainItems).values([
      ...vectorItems,
      {
        ...createInput().item,
        id: "brain-recent-unsynced",
        statement: "Vector同期前の直近Item",
        createdAt: new Date("2026-08-11T00:00:00Z"),
        updatedAt: new Date("2026-08-11T00:00:00Z"),
      },
    ]);
    await db.insert(schema.brainVectorEntries).values(
      vectorItems.map((item, index) => ({
        id: `vector-${index}`,
        brainItemId: item.id,
        itemRevision: item.updatedAt.getTime(),
      })),
    );

    const result = await loadBrainSemanticDedupCandidates(
      db,
      "account-1",
      vectorItems.map((_, index) => `vector-${index}`),
      ["preference"],
    );

    expect(result).toHaveLength(30);
    expect(result.map(({ brainItemId }) => brainItemId)).toContain("brain-recent-unsynced");
  });
});

describe("loadBrainChatContextMemories", () => {
  it("Full関係性履歴はactiveなrelationship Access Labelを持つ本人Itemだけに限定する", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-10T00:00:00Z");
    await db.insert(schema.sourceRecordTextPayloads).values({
      sourceRecordId: "source-1",
      body: "上司と面談して希望を伝えた",
      contentHash: "relationship-source",
    });
    await saveBrainItem(
      db,
      createInput({
        at,
        item: {
          ...createInput().item,
          id: "relationship-memory",
          category: "memory",
          statement: "上司と面談して希望を伝えた",
        },
        evidence: [
          {
            id: "relationship-evidence",
            sourceRecordId: "source-1",
            relation: "supports",
            isDerivationTrigger: true,
            derivationMethod: "ai",
            generatedAt: at,
          },
        ],
        topicLabels: [{ id: "relationship-topic", label: "diary" }],
        accessLabels: [{ id: "relationship-access", label: "relationship", assignedBy: "owner" }],
      }),
    );
    await saveBrainItem(
      db,
      createInput({
        at,
        item: {
          ...createInput().item,
          id: "unconfirmed-memory",
          category: "memory",
          statement: "上司との未確認メモ",
        },
        evidence: [
          {
            id: "unconfirmed-evidence",
            sourceRecordId: "source-1",
            relation: "supports",
            isDerivationTrigger: true,
            derivationMethod: "ai",
            generatedAt: at,
          },
        ],
        topicLabels: [{ id: "unconfirmed-topic", label: "diary" }],
        accessLabels: [{ id: "unconfirmed-access", label: "unclassified", assignedBy: "system" }],
      }),
    );
    await db.insert(schema.brainVectorEntries).values([
      {
        id: "vector-relationship",
        brainItemId: "relationship-memory",
        itemRevision: at.getTime(),
      },
      {
        id: "vector-unconfirmed",
        brainItemId: "unconfirmed-memory",
        itemRevision: at.getTime(),
      },
    ]);

    const result = await loadBrainChatContextMemories(
      db,
      "account-1",
      ["vector-unconfirmed", "vector-relationship"],
      new Date("2026-08-11T00:00:00Z"),
      undefined,
      "relationship",
    );
    expect(result.map(({ brainItemId }) => brainItemId)).toEqual(["relationship-memory"]);
  });

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
    const {
      jobs: [job],
    } = await claimDueBrainVectorSyncJobs(db, at);
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

describe("readPersonalDataFeatureExport", () => {
  it("allowlist済み特徴だけを返し、属性・本文・根拠・識別子を持ち出さない", async () => {
    const db = createTestDb();
    await insertAccountsAndSources(db);
    const at = new Date("2026-08-15T00:00:00.000Z");
    await saveBrainItem(
      db,
      createInput({
        at,
        item: {
          ...createInput().item,
          id: "private-brain-id",
          statement: "外へ出してはいけない本文",
          attributes: {
            isInference: true,
            sessionId: "private-session-id",
            temporalContext: { originalStatement: "来月までに転職したい" },
          },
        },
      }),
    );

    const result = await readPersonalDataFeatureExport(db, "account-1", at);

    expect(result).toMatchObject({
      format: "kagami-brain-features",
      formatVersion: 1,
      scopes: ["metadata", "active", "history"],
      brainItems: [
        expect.objectContaining({
          status: "active",
          isInference: true,
        }),
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("外へ出してはいけない本文");
    expect(serialized).not.toContain("private-brain-id");
    expect(serialized).not.toContain("private-session-id");
    expect(serialized).not.toContain("来月までに転職したい");
    expect(serialized).not.toContain("attributes");
    expect(serialized).not.toContain("source-1");
  });
});
