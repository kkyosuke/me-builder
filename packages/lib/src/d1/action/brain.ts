import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { D1Client } from "../client";
import {
  brainItemAccessLabels,
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItemTopicLabels,
  brainItems,
  brainVectorSyncJobs,
} from "../schema/brain";
import { sourceRecords } from "../schema/source";

type LifecycleColumn = "createdAt" | "updatedAt" | "deletedAt" | "isDeleted";
type EvidenceInsert = typeof brainItemEvidenceEdges.$inferInsert;
type AccessLabelInsert = typeof brainItemAccessLabels.$inferInsert;
type TopicLabelInsert = typeof brainItemTopicLabels.$inferInsert;
type D1BatchStatement = Parameters<D1Client["batch"]>[0][number];

export type SaveBrainItemInput = Readonly<{
  at?: Date;
  item: Omit<typeof brainItems.$inferInsert, LifecycleColumn>;
  evidence: readonly Omit<EvidenceInsert, LifecycleColumn | "accountId" | "brainItemId">[];
  accessLabels: readonly Omit<AccessLabelInsert, LifecycleColumn | "accountId" | "brainItemId">[];
  topicLabels?: readonly Omit<TopicLabelInsert, LifecycleColumn | "accountId" | "brainItemId">[];
  supersedes?: Readonly<{
    revisionId: string;
    brainItemId: string;
    derivationMethod: "ai" | "deterministic";
  }>;
}>;

export type SaveBrainItemResult =
  | Readonly<{ type: "saved"; brainItemId: string }>
  | Readonly<{
      type:
        | "evidence-required"
        | "derivation-trigger-required"
        | "derivation-mismatch"
        | "access-label-required"
        | "invalid-label"
        | "source-account-mismatch"
        | "revision-account-mismatch";
    }>;

const DEVELOPMENT_BRAIN_ITEM_LIMIT = 100;
const VECTOR_SYNC_DISPATCH_RETRY_MS = 15 * 60 * 1000;
const VECTOR_SYNC_FAILURE_RETRY_MS = 60 * 1000;

export type ActiveBrainItemList = Readonly<{
  items: readonly Readonly<{
    id: string;
    category: string;
    statement: string;
    derivation: "ai" | "deterministic";
    status: "active";
    createdAt: Date;
    evidence: readonly Readonly<{
      sourceRecordId: string;
      relation: "supports" | "contradicts";
      derivationMethod: "ai" | "deterministic";
      generatedAt: Date;
    }>[];
  }>[];
  truncated: boolean;
}>;

function hasInvalidOrDuplicateLabels(labels: readonly { label: string }[]): boolean {
  const normalized = labels.map(({ label }) => label.trim());
  return (
    normalized.some((label) => label.length === 0) || new Set(normalized).size !== labels.length
  );
}

/**
 * 入力元に依存せず、Brain Itemと必須のEvidenceを同じatomic batchで保存する。
 * 追加statementは、projection headなど呼び出し側固有の参照も同じbatchへ含めるために使う。
 */
export async function saveBrainItem(
  db: D1Client,
  input: SaveBrainItemInput,
  additionalStatements: readonly D1BatchStatement[] = [],
): Promise<SaveBrainItemResult> {
  if (input.evidence.length === 0) return { type: "evidence-required" };
  const derivationTriggers = input.evidence.filter(
    ({ isDerivationTrigger }) => isDerivationTrigger,
  );
  if (derivationTriggers.length === 0) return { type: "derivation-trigger-required" };
  const expectedDerivation = derivationTriggers.some(
    ({ derivationMethod }) => derivationMethod === "ai",
  )
    ? "ai"
    : "deterministic";
  if (input.item.derivation !== expectedDerivation) return { type: "derivation-mismatch" };
  if (input.accessLabels.length === 0) return { type: "access-label-required" };
  if (
    hasInvalidOrDuplicateLabels(input.accessLabels) ||
    hasInvalidOrDuplicateLabels(input.topicLabels ?? [])
  ) {
    return { type: "invalid-label" };
  }

  const sourceRecordIds = [...new Set(input.evidence.map(({ sourceRecordId }) => sourceRecordId))];
  const ownedSources = await db
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(
      and(
        inArray(sourceRecords.id, sourceRecordIds),
        eq(sourceRecords.accountId, input.item.accountId),
        eq(sourceRecords.isDeleted, false),
      ),
    )
    .all();
  if (ownedSources.length !== sourceRecordIds.length) return { type: "source-account-mismatch" };

  if (input.supersedes) {
    const previousItem = await db
      .select({ id: brainItems.id })
      .from(brainItems)
      .where(
        and(
          eq(brainItems.id, input.supersedes.brainItemId),
          eq(brainItems.accountId, input.item.accountId),
          eq(brainItems.isDeleted, false),
        ),
      )
      .get();
    if (!previousItem) return { type: "revision-account-mismatch" };
  }

  const accountId = input.item.accountId;
  const brainItemId = input.item.id;
  const changedAt = input.at ?? new Date();
  const lifecycle = { createdAt: changedAt, updatedAt: changedAt };
  const itemRevision = changedAt.getTime();
  const statements: D1BatchStatement[] = [
    db.insert(brainItems).values({ ...input.item, ...lifecycle }),
    db.insert(brainVectorSyncJobs).values({
      id: `${brainItemId}:${itemRevision}:upsert`,
      accountId,
      brainItemId,
      itemRevision,
      operation: "upsert",
      status: "pending",
      nextAttemptAt: changedAt,
      ...lifecycle,
    }),
    ...input.evidence.map((edge) =>
      db.insert(brainItemEvidenceEdges).values({ ...edge, ...lifecycle, accountId, brainItemId }),
    ),
    ...input.accessLabels.map((label) =>
      db.insert(brainItemAccessLabels).values({ ...label, ...lifecycle, accountId, brainItemId }),
    ),
    ...(input.topicLabels ?? []).map((label) =>
      db.insert(brainItemTopicLabels).values({ ...label, ...lifecycle, accountId, brainItemId }),
    ),
  ];

  if (input.supersedes) {
    statements.push(
      db
        .update(brainItems)
        .set({ status: "superseded", updatedAt: changedAt })
        .where(
          and(eq(brainItems.id, input.supersedes.brainItemId), eq(brainItems.accountId, accountId)),
        ),
      db.insert(brainItemRevisions).values({
        id: input.supersedes.revisionId,
        accountId,
        previousBrainItemId: input.supersedes.brainItemId,
        nextBrainItemId: brainItemId,
        derivationMethod: input.supersedes.derivationMethod,
        ...lifecycle,
      }),
      db.insert(brainVectorSyncJobs).values({
        id: `${input.supersedes.brainItemId}:${itemRevision}:delete`,
        accountId,
        brainItemId: input.supersedes.brainItemId,
        itemRevision,
        operation: "delete",
        status: "pending",
        nextAttemptAt: changedAt,
        ...lifecycle,
      }),
    );
  }

  const firstStatement = statements[0];
  if (!firstStatement) throw new Error("Brain Itemの保存statementがありません");
  await db.batch([firstStatement, ...statements.slice(1), ...additionalStatements]);
  return { type: "saved", brainItemId };
}

export type BrainVectorSyncJob = Readonly<{
  id: string;
  brainItemId: string;
  itemRevision: number;
}>;

/** Alarm時点で期限を迎えたVector同期jobをclaimする。 */
export async function claimDueBrainVectorSyncJobs(
  db: D1Client,
  accountId: string,
  at = new Date(),
): Promise<BrainVectorSyncJob[]> {
  const due = await db
    .select({
      id: brainVectorSyncJobs.id,
      brainItemId: brainVectorSyncJobs.brainItemId,
      itemRevision: brainVectorSyncJobs.itemRevision,
    })
    .from(brainVectorSyncJobs)
    .where(
      and(
        eq(brainVectorSyncJobs.accountId, accountId),
        inArray(brainVectorSyncJobs.status, ["pending", "submitted", "failed"]),
        lte(brainVectorSyncJobs.nextAttemptAt, at),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .orderBy(asc(brainVectorSyncJobs.nextAttemptAt), asc(brainVectorSyncJobs.id))
    .limit(10)
    .all();
  const claimed: BrainVectorSyncJob[] = [];
  for (const job of due) {
    const rows = await db
      .update(brainVectorSyncJobs)
      .set({
        status: "submitted",
        attemptCount: sql`${brainVectorSyncJobs.attemptCount} + 1`,
        nextAttemptAt: new Date(at.getTime() + VECTOR_SYNC_DISPATCH_RETRY_MS),
        failureCode: null,
        updatedAt: at,
      })
      .where(
        and(
          eq(brainVectorSyncJobs.id, job.id),
          eq(brainVectorSyncJobs.accountId, accountId),
          inArray(brainVectorSyncJobs.status, ["pending", "submitted", "failed"]),
          lte(brainVectorSyncJobs.nextAttemptAt, at),
          eq(brainVectorSyncJobs.isDeleted, false),
        ),
      )
      .returning({ id: brainVectorSyncJobs.id })
      .all();
    if (rows.length > 0) claimed.push(job);
  }
  return claimed;
}

export type BrainVectorSyncTarget =
  | Readonly<{
      action: "upsert";
      statement: string;
      category: string;
      derivation: "ai" | "deterministic";
    }>
  | Readonly<{ action: "delete" }>;

/** Queue本文を信頼せず、job所有権とBrain Itemの現在状態から操作を決める。 */
export async function getBrainVectorSyncTarget(
  db: D1Client,
  accountId: string,
  jobId: string,
  brainItemId: string,
  itemRevision: number,
): Promise<BrainVectorSyncTarget | undefined> {
  const job = await db
    .select({ id: brainVectorSyncJobs.id })
    .from(brainVectorSyncJobs)
    .where(
      and(
        eq(brainVectorSyncJobs.id, jobId),
        eq(brainVectorSyncJobs.accountId, accountId),
        eq(brainVectorSyncJobs.brainItemId, brainItemId),
        eq(brainVectorSyncJobs.itemRevision, itemRevision),
        inArray(brainVectorSyncJobs.status, ["submitted", "failed"]),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .get();
  if (!job) return undefined;
  const item = await db
    .select({
      statement: brainItems.statement,
      category: brainItems.category,
      derivation: brainItems.derivation,
      status: brainItems.status,
      isDeleted: brainItems.isDeleted,
    })
    .from(brainItems)
    .where(and(eq(brainItems.id, brainItemId), eq(brainItems.accountId, accountId)))
    .get();
  if (!item || item.isDeleted || item.status !== "active") return { action: "delete" };
  return {
    action: "upsert",
    statement: item.statement,
    category: item.category,
    derivation: item.derivation,
  };
}

export async function completeBrainVectorSyncJob(
  db: D1Client,
  accountId: string,
  jobId: string,
  mutationId: string,
  at = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(brainVectorSyncJobs)
    .set({ status: "applied", mutationId, failureCode: null, updatedAt: at })
    .where(
      and(
        eq(brainVectorSyncJobs.id, jobId),
        eq(brainVectorSyncJobs.accountId, accountId),
        inArray(brainVectorSyncJobs.status, ["submitted", "failed"]),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .returning({ id: brainVectorSyncJobs.id })
    .all();
  return rows.length > 0;
}

export async function failBrainVectorSyncJob(
  db: D1Client,
  accountId: string,
  jobId: string,
  failureCode: string,
  at = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(brainVectorSyncJobs)
    .set({
      status: "failed",
      failureCode,
      nextAttemptAt: new Date(at.getTime() + VECTOR_SYNC_FAILURE_RETRY_MS),
      updatedAt: at,
    })
    .where(
      and(
        eq(brainVectorSyncJobs.id, jobId),
        eq(brainVectorSyncJobs.accountId, accountId),
        eq(brainVectorSyncJobs.status, "submitted"),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .returning({ id: brainVectorSyncJobs.id })
    .all();
  return rows.length > 0;
}

/** 認証済みAccountの所有物としてBrain Itemを取得する。 */
export async function findBrainItemForAccount(
  db: D1Client,
  input: Readonly<{ accountId: string; brainItemId: string }>,
) {
  return db
    .select()
    .from(brainItems)
    .where(
      and(
        eq(brainItems.id, input.brainItemId),
        eq(brainItems.accountId, input.accountId),
        eq(brainItems.isDeleted, false),
      ),
    )
    .get();
}

/** 開発用の確認画面へ、本人のactiveなBrain Itemと根拠関係だけを新しい順で返す。 */
export async function listActiveBrainItems(
  db: D1Client,
  accountId: string,
): Promise<ActiveBrainItemList> {
  const rows = await db
    .select({
      id: brainItems.id,
      category: brainItems.category,
      statement: brainItems.statement,
      derivation: brainItems.derivation,
      status: brainItems.status,
      createdAt: brainItems.createdAt,
    })
    .from(brainItems)
    .where(
      and(
        eq(brainItems.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
      ),
    )
    .orderBy(desc(brainItems.createdAt), desc(brainItems.id))
    .limit(DEVELOPMENT_BRAIN_ITEM_LIMIT + 1);
  const truncated = rows.length > DEVELOPMENT_BRAIN_ITEM_LIMIT;
  const items = rows.slice(0, DEVELOPMENT_BRAIN_ITEM_LIMIT);
  const itemIds = items.map(({ id }) => id);
  const evidenceRows =
    itemIds.length === 0
      ? []
      : await db
          .select({
            brainItemId: brainItemEvidenceEdges.brainItemId,
            sourceRecordId: brainItemEvidenceEdges.sourceRecordId,
            relation: brainItemEvidenceEdges.relation,
            derivationMethod: brainItemEvidenceEdges.derivationMethod,
            generatedAt: brainItemEvidenceEdges.generatedAt,
          })
          .from(brainItemEvidenceEdges)
          .where(
            and(
              eq(brainItemEvidenceEdges.accountId, accountId),
              inArray(brainItemEvidenceEdges.brainItemId, itemIds),
              eq(brainItemEvidenceEdges.isDeleted, false),
            ),
          )
          .orderBy(brainItemEvidenceEdges.generatedAt, brainItemEvidenceEdges.id);

  return {
    items: items.map((item) => ({
      ...item,
      status: "active" as const,
      evidence: evidenceRows
        .filter(({ brainItemId }) => brainItemId === item.id)
        .map(({ brainItemId: _, ...evidence }) => evidence),
    })),
    truncated,
  };
}
