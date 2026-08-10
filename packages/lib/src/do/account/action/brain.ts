import { and, desc, eq, inArray } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
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
type D1BatchStatement = Parameters<AccountDataDatabase["batch"]>[0][number];

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
  db: AccountDataDatabase,
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
      db.insert(brainItemEvidenceEdges).values({ ...edge, ...lifecycle, brainItemId }),
    ),
    ...input.accessLabels.map((label) =>
      db.insert(brainItemAccessLabels).values({ ...label, ...lifecycle, brainItemId }),
    ),
    ...(input.topicLabels ?? []).map((label) =>
      db.insert(brainItemTopicLabels).values({ ...label, ...lifecycle, brainItemId }),
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
  db: AccountDataDatabase,
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
  db: AccountDataDatabase,
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
