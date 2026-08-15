import { and, asc, count, countDistinct, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import {
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItems,
  progressionEvents,
  sourceRecords,
} from "../schema";

const INITIALIZATION_ORIGIN_ID = "progression-v1";

export type UtsushiProgression = Readonly<{
  level: number;
  growthValue: number;
  currentLevelThreshold: number;
  nextLevelThreshold: number;
  collectedPieces: number;
  activePieces: number;
  categoryCount: number;
}>;

type ProgressionEventKind = typeof progressionEvents.$inferInsert.kind;
type ProgressionOriginType = typeof progressionEvents.$inferInsert.originType;
type D1BatchStatement = Parameters<AccountDataDatabase["batch"]>[0][number];

function isInference(attributes: unknown, derivation: "ai" | "deterministic"): boolean {
  return attributes &&
    typeof attributes === "object" &&
    "isInference" in attributes &&
    typeof attributes.isInference === "boolean"
    ? attributes.isInference
    : derivation === "ai";
}

function isDiaryItem(attributes: unknown): boolean {
  return (
    attributes !== null &&
    typeof attributes === "object" &&
    "sourceKind" in attributes &&
    attributes.sourceKind === "diary"
  );
}

function eventId(originType: ProgressionOriginType, originId: string): string {
  return `progression:v1:${originType}:${originId}`;
}

function eventStatement(
  db: AccountDataDatabase,
  input: Readonly<{
    accountId: string;
    originType: ProgressionOriginType;
    originId: string;
    kind: ProgressionEventKind;
    growthDelta: number;
    collectedPieceDelta: number;
    at: Date;
  }>,
): D1BatchStatement {
  return db
    .insert(progressionEvents)
    .values({
      id: eventId(input.originType, input.originId),
      accountId: input.accountId,
      originType: input.originType,
      originId: input.originId,
      kind: input.kind,
      growthDelta: input.growthDelta,
      collectedPieceDelta: input.collectedPieceDelta,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .onConflictDoNothing();
}

/** 累積成長値から、上限を持たないレベル閾値を返す。 */
export function progressionThreshold(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1)
    throw new Error("Level must be a positive integer");
  const threshold = 5 * (level - 1) ** 2;
  if (!Number.isSafeInteger(threshold))
    throw new Error("Level threshold exceeds safe integer range");
  return threshold;
}

export function progressionLevel(growthValue: number): number {
  if (!Number.isSafeInteger(growthValue) || growthValue < 0) {
    throw new Error("Growth value must be a non-negative safe integer");
  }
  return Math.floor(Math.sqrt(growthValue / 5)) + 1;
}

/**
 * 既存Brainを初回開始値へ変換し、その後に増えたItem / Evidenceを一度だけ記録する。
 * AccountDataはoperationを直列化するため、初期化markerと各eventを同じbatchへ保存できる。
 */
async function synchronizeProgressionEvents(
  db: AccountDataDatabase,
  accountId: string,
  at: Date,
): Promise<void> {
  const initialized = await db
    .select({ id: progressionEvents.id })
    .from(progressionEvents)
    .where(
      and(
        eq(progressionEvents.accountId, accountId),
        eq(progressionEvents.originType, "initialization"),
        eq(progressionEvents.originId, INITIALIZATION_ORIGIN_ID),
      ),
    )
    .get();
  const isInitialization = !initialized;

  const missingItems = await db
    .select({
      id: brainItems.id,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
      status: brainItems.status,
      isDeleted: brainItems.isDeleted,
    })
    .from(brainItems)
    .leftJoin(
      progressionEvents,
      and(
        eq(progressionEvents.accountId, accountId),
        eq(progressionEvents.originType, "brain_item"),
        eq(progressionEvents.originId, brainItems.id),
      ),
    )
    .where(and(eq(brainItems.accountId, accountId), isNull(progressionEvents.id)))
    .all();
  const revisions = await db
    .select({ nextBrainItemId: brainItemRevisions.nextBrainItemId })
    .from(brainItemRevisions)
    .where(eq(brainItemRevisions.isDeleted, false))
    .all();
  const revisedItemIds = new Set(revisions.map(({ nextBrainItemId }) => nextBrainItemId));

  const evidenceRows = await db
    .select({
      id: brainItemEvidenceEdges.id,
      brainItemId: brainItemEvidenceEdges.brainItemId,
      relation: brainItemEvidenceEdges.relation,
      edgeIsDeleted: brainItemEvidenceEdges.isDeleted,
      sourceIsDeleted: sourceRecords.isDeleted,
      itemAttributes: brainItems.attributes,
      itemDerivation: brainItems.derivation,
      itemStatus: brainItems.status,
      itemIsDeleted: brainItems.isDeleted,
    })
    .from(brainItemEvidenceEdges)
    .innerJoin(brainItems, eq(brainItems.id, brainItemEvidenceEdges.brainItemId))
    .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
    .where(eq(brainItems.accountId, accountId))
    .orderBy(asc(brainItemEvidenceEdges.createdAt), asc(brainItemEvidenceEdges.id))
    .all();
  const recordedEvidence = await db
    .select({ originId: progressionEvents.originId })
    .from(progressionEvents)
    .where(
      and(eq(progressionEvents.accountId, accountId), eq(progressionEvents.originType, "evidence")),
    )
    .all();
  const recordedEvidenceIds = new Set(recordedEvidence.map(({ originId }) => originId));
  const validEvidencePositionByItem = new Map<string, number>();
  const statements: D1BatchStatement[] = [];

  for (const item of missingItems) {
    const inference = isInference(item.attributes, item.derivation);
    const revision = revisedItemIds.has(item.id);
    const temporalRevision = revision && isDiaryItem(item.attributes);
    const availableAtInitialization = item.status === "active" && !item.isDeleted;
    const growthDelta =
      isInitialization && !availableAtInitialization
        ? 0
        : temporalRevision
          ? 2
          : revision || inference
            ? 0
            : 3;
    const kind: ProgressionEventKind = temporalRevision
      ? "temporal_revision"
      : revision
        ? "correction_revision"
        : inference
          ? "inference_item"
          : "new_item";
    statements.push(
      eventStatement(db, {
        accountId,
        originType: "brain_item",
        originId: item.id,
        kind,
        growthDelta,
        collectedPieceDelta: isInitialization && item.isDeleted ? 0 : 1,
        at,
      }),
    );
  }

  for (const evidence of evidenceRows) {
    const valid =
      evidence.relation === "supports" &&
      !evidence.edgeIsDeleted &&
      !evidence.sourceIsDeleted &&
      !evidence.itemIsDeleted &&
      evidence.itemStatus === "active" &&
      !isInference(evidence.itemAttributes, evidence.itemDerivation);
    const position = validEvidencePositionByItem.get(evidence.brainItemId) ?? 0;
    if (valid) validEvidencePositionByItem.set(evidence.brainItemId, position + 1);
    if (recordedEvidenceIds.has(evidence.id)) continue;
    statements.push(
      eventStatement(db, {
        accountId,
        originType: "evidence",
        originId: evidence.id,
        kind: "evidence_added",
        growthDelta: valid && position > 0 ? 1 : 0,
        collectedPieceDelta: 0,
        at,
      }),
    );
  }

  if (isInitialization) {
    statements.push(
      eventStatement(db, {
        accountId,
        originType: "initialization",
        originId: INITIALIZATION_ORIGIN_ID,
        kind: "initialization",
        growthDelta: 0,
        collectedPieceDelta: 0,
        at,
      }),
    );
  }
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

/** 本人の累積成長値と、現在利用可能なかけら数を返す。 */
export async function readUtsushiProgression(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<UtsushiProgression> {
  await synchronizeProgressionEvents(db, accountId, at);
  const [totals, active] = await Promise.all([
    db
      .select({
        growthValue: sql<number>`coalesce(sum(${progressionEvents.growthDelta}), 0)`,
        collectedPieces: sql<number>`coalesce(sum(${progressionEvents.collectedPieceDelta}), 0)`,
      })
      .from(progressionEvents)
      .where(
        and(eq(progressionEvents.accountId, accountId), eq(progressionEvents.isDeleted, false)),
      )
      .get(),
    db
      .select({
        activePieces: count(brainItems.id),
        categoryCount: countDistinct(brainItems.category),
      })
      .from(brainItems)
      .where(
        and(
          eq(brainItems.accountId, accountId),
          eq(brainItems.status, "active"),
          eq(brainItems.isDeleted, false),
          or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
          or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
        ),
      )
      .get(),
  ]);
  const growthValue = Number(totals?.growthValue ?? 0);
  const collectedPieces = Number(totals?.collectedPieces ?? 0);
  const level = progressionLevel(growthValue);
  return {
    level,
    growthValue,
    currentLevelThreshold: progressionThreshold(level),
    nextLevelThreshold: progressionThreshold(level + 1),
    collectedPieces,
    activePieces: active?.activePieces ?? 0,
    categoryCount: active?.categoryCount ?? 0,
  };
}
