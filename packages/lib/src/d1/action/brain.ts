import { and, asc, countDistinct, desc, eq, inArray } from "drizzle-orm";
import type { D1Client } from "../client";
import {
  brainItemAccessLabels,
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItemTopicLabels,
  brainItems,
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
  const lifecycle = input.at ? { createdAt: input.at, updatedAt: input.at } : {};
  const statements: D1BatchStatement[] = [
    db.insert(brainItems).values({ ...input.item, ...lifecycle }),
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
        .set({ status: "superseded", updatedAt: input.at })
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
    );
  }

  const firstStatement = statements[0];
  if (!firstStatement) throw new Error("Brain Itemの保存statementがありません");
  await db.batch([firstStatement, ...statements.slice(1), ...additionalStatements]);
  return { type: "saved", brainItemId };
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

export type ProfileSummaryDiaryMemory = Readonly<{
  id: string;
  statement: string;
  recordedAt: string;
  evidenceCount: number;
}>;

export type ProfileSummaryDiaryData = Readonly<{
  memories: readonly ProfileSummaryDiaryMemory[];
  memoryCount: number;
}>;

/** 本人向けサマリーへ表示するactiveな日記Memoryを新しい順で取得する。 */
export async function findProfileSummaryDiaryData(
  db: D1Client,
  accountId: string,
): Promise<ProfileSummaryDiaryData> {
  const filters = and(
    eq(brainItems.accountId, accountId),
    eq(brainItems.category, "memory"),
    eq(brainItems.derivation, "ai"),
    eq(brainItems.status, "active"),
    eq(brainItems.isDeleted, false),
    eq(brainItemTopicLabels.accountId, accountId),
    eq(brainItemTopicLabels.label, "diary"),
    eq(brainItemTopicLabels.isDeleted, false),
    eq(brainItemEvidenceEdges.accountId, accountId),
    eq(brainItemEvidenceEdges.relation, "supports"),
    eq(brainItemEvidenceEdges.isDeleted, false),
    eq(sourceRecords.accountId, accountId),
    eq(sourceRecords.isDeleted, false),
  );
  const baseQuery = db
    .select({
      id: brainItems.id,
      statement: brainItems.statement,
      validFrom: brainItems.validFrom,
      createdAt: brainItems.createdAt,
      evidenceCount: countDistinct(brainItemEvidenceEdges.sourceRecordId),
    })
    .from(brainItems)
    .innerJoin(brainItemTopicLabels, eq(brainItemTopicLabels.brainItemId, brainItems.id))
    .innerJoin(brainItemEvidenceEdges, eq(brainItemEvidenceEdges.brainItemId, brainItems.id))
    .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
    .where(filters)
    .groupBy(brainItems.id);
  const [rows, countRows] = await Promise.all([
    baseQuery
      .orderBy(desc(brainItems.validFrom), desc(brainItems.createdAt), asc(brainItems.id))
      .limit(3)
      .all(),
    db
      .select({ value: countDistinct(brainItems.id) })
      .from(brainItems)
      .innerJoin(brainItemTopicLabels, eq(brainItemTopicLabels.brainItemId, brainItems.id))
      .innerJoin(brainItemEvidenceEdges, eq(brainItemEvidenceEdges.brainItemId, brainItems.id))
      .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
      .where(filters)
      .all(),
  ]);

  return {
    memories: rows.map(({ id, statement, validFrom, createdAt, evidenceCount }) => ({
      id,
      statement,
      recordedAt: (validFrom ?? createdAt).toISOString(),
      evidenceCount,
    })),
    memoryCount: countRows[0]?.value ?? 0,
  };
}
