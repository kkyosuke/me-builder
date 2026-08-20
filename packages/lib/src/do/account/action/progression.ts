import { and, asc, count, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import {
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItems,
  diagnosisBrainProjectionRequests,
  diagnosisResponses,
  progressionEvents,
  progressionItemStates,
  progressionMilestones,
  progressionPendingEvents,
  progressionStates,
  sourceRecordTextPayloads,
  sourceRecords,
} from "../schema";

const INITIALIZATION_ORIGIN_ID = "progression-v1";
const UTSUSHI_PROGRESSION_CALCULATION_VERSION = 1;

export type UtsushiProgression = Readonly<{
  level: number;
  growthValue: number;
  currentLevelThreshold: number;
  nextLevelThreshold: number;
  collectedPieces: number;
  activePieces: number;
  categoryCount: number;
  calculationVersion: number;
  highestLevel: number;
  isProcessing: boolean;
  recentChanges: readonly UtsushiProgressionChange[];
  milestoneCards: readonly UtsushiMilestoneCard[];
}>;

type UtsushiProgressionChange = Readonly<{
  kind: "new_piece" | "evidence_deepened" | "temporal_change";
  growthDelta: number;
  occurredAt: string;
}>;

type UtsushiMilestoneCard = Readonly<{
  level: number;
  reachedAt: string;
  collectedPiecesDelta: number;
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

function evidenceFingerprint(sourceRecordId: string, contentHash: string | null): string {
  return contentHash ? `content:${contentHash}` : `source:${sourceRecordId}`;
}

function readEvidenceFingerprints(value: string): Set<string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function eventId(originType: ProgressionOriginType, originId: string): string {
  return `progression:v1:${originType}:${originId}`;
}

/** Brainの更新と同じbatchで、進行度へ反映する差分だけを積む。 */
export function progressionPendingStatement(
  db: AccountDataDatabase,
  input: Readonly<{
    accountId: string;
    originType: "brain_item" | "evidence";
    originId: string;
    at: Date;
  }>,
): D1BatchStatement {
  return db
    .insert(progressionPendingEvents)
    .values({
      id: `progression:pending:v1:${input.originType}:${input.originId}`,
      accountId: input.accountId,
      originType: input.originType,
      originId: input.originId,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .onConflictDoNothing();
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
    category: string | null;
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
      calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
      growthDelta: input.growthDelta,
      collectedPieceDelta: input.collectedPieceDelta,
      category: input.category,
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

type ProgressionTotals = Readonly<{
  growthValue: number;
  collectedPieces: number;
  calculationVersion: number;
  highestLevel: number;
}>;

function isAvailableItem(
  item: Readonly<{
    status: "active" | "superseded" | "invalidated";
    isDeleted: boolean;
    validFrom: Date | null;
    validTo: Date | null;
  }>,
  at: Date,
): boolean {
  return (
    item.status === "active" &&
    !item.isDeleted &&
    (!item.validFrom || item.validFrom <= at) &&
    (!item.validTo || item.validTo > at)
  );
}

function itemProgressionEvent(
  db: AccountDataDatabase,
  input: Readonly<{
    accountId: string;
    item: {
      id: string;
      category: string;
      attributes: unknown;
      derivation: "ai" | "deterministic";
      status: "active" | "superseded" | "invalidated";
      isDeleted: boolean;
      validFrom: Date | null;
      validTo: Date | null;
    };
    revisionKind: "correction" | "temporal" | null;
    initialization: boolean;
    availabilityAt: Date;
    at: Date;
  }>,
): Readonly<{ statement: D1BatchStatement; growthDelta: number; collectedPieceDelta: number }> {
  const inference = isInference(input.item.attributes, input.item.derivation);
  const temporalRevision = input.revisionKind === "temporal";
  const availableAtInitialization = isAvailableItem(input.item, input.availabilityAt);
  const growthDelta =
    input.initialization && !availableAtInitialization
      ? 0
      : inference
        ? 0
        : temporalRevision
          ? 2
          : input.revisionKind
            ? 0
            : 3;
  const kind: ProgressionEventKind = inference
    ? "inference_item"
    : temporalRevision
      ? "temporal_revision"
      : input.revisionKind
        ? "correction_revision"
        : "new_item";
  const collectedPieceDelta = input.initialization && !availableAtInitialization ? 0 : 1;
  return {
    statement: eventStatement(db, {
      accountId: input.accountId,
      originType: "brain_item",
      originId: input.item.id,
      kind,
      growthDelta,
      collectedPieceDelta,
      category: input.item.category,
      at: input.at,
    }),
    growthDelta,
    collectedPieceDelta,
  };
}

async function initializeProgressionEvents(
  db: AccountDataDatabase,
  accountId: string,
  at: Date,
): Promise<ProgressionTotals> {
  const [items, revisions, evidenceRows, existingEvents] = await Promise.all([
    db
      .select({
        id: brainItems.id,
        category: brainItems.category,
        attributes: brainItems.attributes,
        derivation: brainItems.derivation,
        status: brainItems.status,
        isDeleted: brainItems.isDeleted,
        validFrom: brainItems.validFrom,
        validTo: brainItems.validTo,
        occurredAt: brainItems.createdAt,
        progressionEventId: progressionEvents.id,
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
      .where(eq(brainItems.accountId, accountId))
      .all(),
    db
      .select({
        nextBrainItemId: brainItemRevisions.nextBrainItemId,
        changeKind: brainItemRevisions.changeKind,
      })
      .from(brainItemRevisions)
      .where(eq(brainItemRevisions.isDeleted, false))
      .all(),
    db
      .select({
        id: brainItemEvidenceEdges.id,
        brainItemId: brainItemEvidenceEdges.brainItemId,
        sourceRecordId: brainItemEvidenceEdges.sourceRecordId,
        contentHash: sourceRecordTextPayloads.contentHash,
        relation: brainItemEvidenceEdges.relation,
        edgeIsDeleted: brainItemEvidenceEdges.isDeleted,
        sourceIsDeleted: sourceRecords.isDeleted,
        itemAttributes: brainItems.attributes,
        itemCategory: brainItems.category,
        itemDerivation: brainItems.derivation,
        itemStatus: brainItems.status,
        itemIsDeleted: brainItems.isDeleted,
        itemValidFrom: brainItems.validFrom,
        itemValidTo: brainItems.validTo,
        occurredAt: brainItemEvidenceEdges.createdAt,
        progressionEventId: progressionEvents.id,
      })
      .from(brainItemEvidenceEdges)
      .innerJoin(brainItems, eq(brainItems.id, brainItemEvidenceEdges.brainItemId))
      .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
      .leftJoin(
        sourceRecordTextPayloads,
        eq(sourceRecordTextPayloads.sourceRecordId, sourceRecords.id),
      )
      .leftJoin(
        progressionEvents,
        and(
          eq(progressionEvents.accountId, accountId),
          eq(progressionEvents.originType, "evidence"),
          eq(progressionEvents.originId, brainItemEvidenceEdges.id),
        ),
      )
      .where(eq(brainItems.accountId, accountId))
      .orderBy(asc(brainItemEvidenceEdges.createdAt), asc(brainItemEvidenceEdges.id))
      .all(),
    db
      .select({
        originType: progressionEvents.originType,
        originId: progressionEvents.originId,
        growthDelta: progressionEvents.growthDelta,
        collectedPieceDelta: progressionEvents.collectedPieceDelta,
      })
      .from(progressionEvents)
      .where(
        and(eq(progressionEvents.accountId, accountId), eq(progressionEvents.isDeleted, false)),
      )
      .all(),
  ]);
  const revisionKindByItemId = new Map(
    revisions.map(({ nextBrainItemId, changeKind }) => [nextBrainItemId, changeKind] as const),
  );
  const evidenceFingerprintsByItem = new Map<string, Set<string>>();
  const statements: D1BatchStatement[] = [];
  let growthValue = existingEvents.reduce((sum, event) => sum + event.growthDelta, 0);
  let collectedPieces = existingEvents.reduce((sum, event) => sum + event.collectedPieceDelta, 0);

  for (const evidence of evidenceRows) {
    const valid =
      evidence.relation === "supports" &&
      !evidence.edgeIsDeleted &&
      !evidence.sourceIsDeleted &&
      isAvailableItem(
        {
          status: evidence.itemStatus,
          isDeleted: evidence.itemIsDeleted,
          validFrom: evidence.itemValidFrom,
          validTo: evidence.itemValidTo,
        },
        at,
      ) &&
      !isInference(evidence.itemAttributes, evidence.itemDerivation);
    const fingerprints = evidenceFingerprintsByItem.get(evidence.brainItemId) ?? new Set<string>();
    const fingerprint = evidenceFingerprint(evidence.sourceRecordId, evidence.contentHash);
    const duplicate = fingerprints.has(fingerprint);
    const position = fingerprints.size;
    if (valid && !duplicate) {
      fingerprints.add(fingerprint);
      evidenceFingerprintsByItem.set(evidence.brainItemId, fingerprints);
    }
    if (evidence.progressionEventId) continue;
    const growthDelta = valid && !duplicate && position > 0 ? 1 : 0;
    const kind: ProgressionEventKind = !valid
      ? "ignored_evidence"
      : duplicate
        ? "duplicate_evidence"
        : position === 0
          ? "initial_evidence"
          : "evidence_added";
    statements.push(
      eventStatement(db, {
        accountId,
        originType: "evidence",
        originId: evidence.id,
        kind,
        growthDelta,
        collectedPieceDelta: 0,
        category: evidence.itemCategory,
        at: evidence.occurredAt,
      }),
    );
    growthValue += growthDelta;
  }

  for (const item of items) {
    if (!item.progressionEventId) {
      const event = itemProgressionEvent(db, {
        accountId,
        item,
        revisionKind: revisionKindByItemId.get(item.id) ?? null,
        initialization: true,
        availabilityAt: at,
        at: item.occurredAt,
      });
      statements.push(event.statement);
      growthValue += event.growthDelta;
      collectedPieces += event.collectedPieceDelta;
    }
    statements.push(
      db
        .insert(progressionItemStates)
        .values({
          id: `progression:item-state:v1:${item.id}`,
          accountId,
          brainItemId: item.id,
          recognizedEvidenceCount: evidenceFingerprintsByItem.get(item.id)?.size ?? 0,
          recognizedEvidenceFingerprintsJson: JSON.stringify([
            ...(evidenceFingerprintsByItem.get(item.id) ?? []),
          ]),
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoNothing(),
    );
  }

  if (
    !existingEvents.some(
      ({ originType, originId }) =>
        originType === "initialization" && originId === INITIALIZATION_ORIGIN_ID,
    )
  ) {
    statements.push(
      eventStatement(db, {
        accountId,
        originType: "initialization",
        originId: INITIALIZATION_ORIGIN_ID,
        kind: "initialization",
        growthDelta: 0,
        collectedPieceDelta: 0,
        category: null,
        at,
      }),
    );
  }
  statements.push(
    db.delete(progressionPendingEvents).where(eq(progressionPendingEvents.accountId, accountId)),
    db.insert(progressionStates).values({
      id: `progression:state:v1:${accountId}`,
      accountId,
      growthValue,
      collectedPieces,
      calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
      highestLevel: progressionLevel(growthValue),
      createdAt: at,
      updatedAt: at,
    }),
  );
  const [first, ...rest] = statements;
  if (!first) throw new Error("Progression initialization statements are missing");
  await db.batch([first, ...rest]);
  return {
    growthValue,
    collectedPieces,
    calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
    highestLevel: progressionLevel(growthValue),
  };
}

/** 初回だけ既存Brainを集計し、その後はBrain更新時に積んだ差分だけを反映する。 */
async function synchronizeProgressionEvents(
  db: AccountDataDatabase,
  accountId: string,
  at: Date,
): Promise<ProgressionTotals> {
  let state = await db
    .select({
      growthValue: progressionStates.growthValue,
      collectedPieces: progressionStates.collectedPieces,
      calculationVersion: progressionStates.calculationVersion,
      highestLevel: progressionStates.highestLevel,
    })
    .from(progressionStates)
    .where(and(eq(progressionStates.accountId, accountId), eq(progressionStates.isDeleted, false)))
    .get();
  if (!state) return initializeProgressionEvents(db, accountId, at);
  if (state.calculationVersion !== UTSUSHI_PROGRESSION_CALCULATION_VERSION) {
    // 版変更は将来eventへだけ適用し、確定済みeventと累積値は改変しない。
    await db
      .update(progressionStates)
      .set({
        calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
        updatedAt: at,
      })
      .where(eq(progressionStates.accountId, accountId));
    state = {
      ...state,
      calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
    };
  }

  const pending = await db
    .select({ id: progressionPendingEvents.id })
    .from(progressionPendingEvents)
    .where(eq(progressionPendingEvents.accountId, accountId))
    .get();
  if (!pending) return state;

  const [items, revisions, evidenceRows, itemEvidenceStates] = await Promise.all([
    db
      .select({
        id: brainItems.id,
        category: brainItems.category,
        attributes: brainItems.attributes,
        derivation: brainItems.derivation,
        status: brainItems.status,
        isDeleted: brainItems.isDeleted,
        validFrom: brainItems.validFrom,
        validTo: brainItems.validTo,
        occurredAt: progressionPendingEvents.createdAt,
      })
      .from(brainItems)
      .innerJoin(
        progressionPendingEvents,
        and(
          eq(progressionPendingEvents.accountId, accountId),
          eq(progressionPendingEvents.originType, "brain_item"),
          eq(progressionPendingEvents.originId, brainItems.id),
        ),
      )
      .leftJoin(
        progressionEvents,
        and(
          eq(progressionEvents.accountId, accountId),
          eq(progressionEvents.originType, "brain_item"),
          eq(progressionEvents.originId, brainItems.id),
        ),
      )
      .where(isNull(progressionEvents.id))
      .all(),
    db
      .select({
        nextBrainItemId: brainItemRevisions.nextBrainItemId,
        changeKind: brainItemRevisions.changeKind,
      })
      .from(brainItemRevisions)
      .innerJoin(
        progressionPendingEvents,
        and(
          eq(progressionPendingEvents.accountId, accountId),
          eq(progressionPendingEvents.originType, "brain_item"),
          eq(progressionPendingEvents.originId, brainItemRevisions.nextBrainItemId),
        ),
      )
      .where(eq(brainItemRevisions.isDeleted, false))
      .all(),
    db
      .select({
        id: brainItemEvidenceEdges.id,
        brainItemId: brainItemEvidenceEdges.brainItemId,
        sourceRecordId: brainItemEvidenceEdges.sourceRecordId,
        contentHash: sourceRecordTextPayloads.contentHash,
        relation: brainItemEvidenceEdges.relation,
        edgeIsDeleted: brainItemEvidenceEdges.isDeleted,
        sourceIsDeleted: sourceRecords.isDeleted,
        itemAttributes: brainItems.attributes,
        itemCategory: brainItems.category,
        itemDerivation: brainItems.derivation,
        itemStatus: brainItems.status,
        itemIsDeleted: brainItems.isDeleted,
        itemValidFrom: brainItems.validFrom,
        itemValidTo: brainItems.validTo,
        occurredAt: progressionPendingEvents.createdAt,
      })
      .from(brainItemEvidenceEdges)
      .innerJoin(
        progressionPendingEvents,
        and(
          eq(progressionPendingEvents.accountId, accountId),
          eq(progressionPendingEvents.originType, "evidence"),
          eq(progressionPendingEvents.originId, brainItemEvidenceEdges.id),
        ),
      )
      .innerJoin(brainItems, eq(brainItems.id, brainItemEvidenceEdges.brainItemId))
      .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
      .leftJoin(
        sourceRecordTextPayloads,
        eq(sourceRecordTextPayloads.sourceRecordId, sourceRecords.id),
      )
      .leftJoin(
        progressionEvents,
        and(
          eq(progressionEvents.accountId, accountId),
          eq(progressionEvents.originType, "evidence"),
          eq(progressionEvents.originId, brainItemEvidenceEdges.id),
        ),
      )
      .where(isNull(progressionEvents.id))
      .orderBy(asc(brainItemEvidenceEdges.createdAt), asc(brainItemEvidenceEdges.id))
      .all(),
    db
      .select({
        brainItemId: progressionItemStates.brainItemId,
        recognizedEvidenceCount: progressionItemStates.recognizedEvidenceCount,
        recognizedEvidenceFingerprintsJson:
          progressionItemStates.recognizedEvidenceFingerprintsJson,
      })
      .from(progressionItemStates)
      .innerJoin(
        brainItemEvidenceEdges,
        eq(brainItemEvidenceEdges.brainItemId, progressionItemStates.brainItemId),
      )
      .innerJoin(
        progressionPendingEvents,
        and(
          eq(progressionPendingEvents.accountId, accountId),
          eq(progressionPendingEvents.originType, "evidence"),
          eq(progressionPendingEvents.originId, brainItemEvidenceEdges.id),
        ),
      )
      .where(eq(progressionItemStates.accountId, accountId))
      .all(),
  ]);
  const revisionKindByItemId = new Map(
    revisions.map(({ nextBrainItemId, changeKind }) => [nextBrainItemId, changeKind] as const),
  );
  const evidenceFingerprintsByItem = new Map(
    itemEvidenceStates.map(
      ({ brainItemId, recognizedEvidenceFingerprintsJson }) =>
        [brainItemId, readEvidenceFingerprints(recognizedEvidenceFingerprintsJson)] as const,
    ),
  );
  const affectedItemIds = new Set(items.map(({ id }) => id));
  const statements: D1BatchStatement[] = [];
  let growthDelta = 0;
  let collectedPieceDelta = 0;

  for (const item of items) {
    const event = itemProgressionEvent(db, {
      accountId,
      item,
      revisionKind: revisionKindByItemId.get(item.id) ?? null,
      initialization: false,
      availabilityAt: item.occurredAt,
      at: item.occurredAt,
    });
    statements.push(event.statement);
    growthDelta += event.growthDelta;
    collectedPieceDelta += event.collectedPieceDelta;
    if (!evidenceFingerprintsByItem.has(item.id)) {
      evidenceFingerprintsByItem.set(item.id, new Set());
    }
  }

  for (const evidence of evidenceRows) {
    const valid =
      evidence.relation === "supports" &&
      !evidence.edgeIsDeleted &&
      !evidence.sourceIsDeleted &&
      isAvailableItem(
        {
          status: evidence.itemStatus,
          isDeleted: evidence.itemIsDeleted,
          validFrom: evidence.itemValidFrom,
          validTo: evidence.itemValidTo,
        },
        evidence.occurredAt,
      ) &&
      !isInference(evidence.itemAttributes, evidence.itemDerivation);
    const fingerprints = evidenceFingerprintsByItem.get(evidence.brainItemId) ?? new Set<string>();
    const fingerprint = evidenceFingerprint(evidence.sourceRecordId, evidence.contentHash);
    const duplicate = fingerprints.has(fingerprint);
    const evidenceCount = fingerprints.size;
    const eventGrowthDelta = valid && !duplicate && evidenceCount > 0 ? 1 : 0;
    const kind: ProgressionEventKind = !valid
      ? "ignored_evidence"
      : duplicate
        ? "duplicate_evidence"
        : evidenceCount === 0
          ? "initial_evidence"
          : "evidence_added";
    statements.push(
      eventStatement(db, {
        accountId,
        originType: "evidence",
        originId: evidence.id,
        kind,
        growthDelta: eventGrowthDelta,
        collectedPieceDelta: 0,
        category: evidence.itemCategory,
        at: evidence.occurredAt,
      }),
    );
    growthDelta += eventGrowthDelta;
    if (valid && !duplicate) {
      fingerprints.add(fingerprint);
      evidenceFingerprintsByItem.set(evidence.brainItemId, fingerprints);
      affectedItemIds.add(evidence.brainItemId);
    }
  }

  for (const brainItemId of affectedItemIds) {
    statements.push(
      db
        .insert(progressionItemStates)
        .values({
          id: `progression:item-state:v1:${brainItemId}`,
          accountId,
          brainItemId,
          recognizedEvidenceCount: evidenceFingerprintsByItem.get(brainItemId)?.size ?? 0,
          recognizedEvidenceFingerprintsJson: JSON.stringify([
            ...(evidenceFingerprintsByItem.get(brainItemId) ?? []),
          ]),
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [progressionItemStates.accountId, progressionItemStates.brainItemId],
          set: {
            recognizedEvidenceCount: evidenceFingerprintsByItem.get(brainItemId)?.size ?? 0,
            recognizedEvidenceFingerprintsJson: JSON.stringify([
              ...(evidenceFingerprintsByItem.get(brainItemId) ?? []),
            ]),
            updatedAt: at,
          },
        }),
    );
  }
  const totals = {
    growthValue: state.growthValue + growthDelta,
    collectedPieces: state.collectedPieces + collectedPieceDelta,
    calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
    highestLevel: Math.max(state.highestLevel, progressionLevel(state.growthValue + growthDelta)),
  };
  statements.push(
    db.delete(progressionPendingEvents).where(eq(progressionPendingEvents.accountId, accountId)),
    db
      .update(progressionStates)
      .set({ ...totals, updatedAt: at })
      .where(eq(progressionStates.accountId, accountId)),
  );
  const [first, ...rest] = statements;
  if (!first) throw new Error("Progression synchronization statements are missing");
  await db.batch([first, ...rest]);
  return totals;
}

/** 本人の累積成長値と、現在利用可能なかけら数を返す。 */
export async function readUtsushiProgression(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<UtsushiProgression> {
  const totals = await synchronizeProgressionEvents(db, accountId, at);
  const [activeCategories, recentEvents, savedMilestones, pendingProjection] = await Promise.all([
    db
      .select({
        category: brainItems.category,
        activePieces: count(brainItems.id),
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
      .groupBy(brainItems.category)
      .orderBy(asc(brainItems.category))
      .all(),
    db
      .select({
        kind: progressionEvents.kind,
        growthDelta: progressionEvents.growthDelta,
        occurredAt: progressionEvents.createdAt,
      })
      .from(progressionEvents)
      .where(
        and(
          eq(progressionEvents.accountId, accountId),
          eq(progressionEvents.isDeleted, false),
          gt(progressionEvents.growthDelta, 0),
        ),
      )
      .orderBy(desc(progressionEvents.createdAt), desc(progressionEvents.id))
      .limit(3)
      .all(),
    db
      .select({
        level: progressionMilestones.level,
        reachedAt: progressionMilestones.createdAt,
        collectedPiecesDelta: progressionMilestones.collectedPiecesDelta,
        collectedPiecesTotal: progressionMilestones.collectedPiecesTotal,
        categoriesJson: progressionMilestones.categoriesJson,
      })
      .from(progressionMilestones)
      .where(
        and(
          eq(progressionMilestones.accountId, accountId),
          eq(progressionMilestones.isDeleted, false),
        ),
      )
      .orderBy(desc(progressionMilestones.level))
      .all(),
    db
      .select({ id: diagnosisBrainProjectionRequests.id })
      .from(diagnosisBrainProjectionRequests)
      .innerJoin(
        diagnosisResponses,
        eq(diagnosisResponses.id, diagnosisBrainProjectionRequests.diagnosisResponseId),
      )
      .where(
        and(
          eq(diagnosisResponses.accountId, accountId),
          inArray(diagnosisBrainProjectionRequests.status, ["pending", "failed"]),
          eq(diagnosisBrainProjectionRequests.isDeleted, false),
        ),
      )
      .get(),
  ]);
  const growthValue = totals.growthValue;
  const collectedPieces = totals.collectedPieces;
  const level = Math.max(progressionLevel(growthValue), totals.highestLevel);
  const categories = activeCategories.map(({ category }) => category);
  const milestoneLevel = Math.floor(level / 10) * 10;
  const savedMilestoneLevels = new Set(savedMilestones.map(({ level: savedLevel }) => savedLevel));
  const savedMilestonesByLevel = new Map(
    savedMilestones.map((milestone) => [milestone.level, milestone] as const),
  );
  const missingMilestoneLevels = Array.from(
    { length: Math.floor(milestoneLevel / 10) },
    (_, index) => (index + 1) * 10,
  ).filter((candidateLevel) => !savedMilestoneLevels.has(candidateLevel));
  const newMilestones: Array<{
    level: number;
    reachedAt: Date;
    collectedPiecesDelta: number;
    collectedPiecesTotal: number;
    categoriesJson: string;
  }> = [];
  if (missingMilestoneLevels.length > 0) {
    const timeline = await db
      .select({
        growthDelta: progressionEvents.growthDelta,
        collectedPieceDelta: progressionEvents.collectedPieceDelta,
        category: progressionEvents.category,
        occurredAt: progressionEvents.createdAt,
      })
      .from(progressionEvents)
      .where(
        and(eq(progressionEvents.accountId, accountId), eq(progressionEvents.isDeleted, false)),
      )
      .orderBy(asc(progressionEvents.createdAt), asc(progressionEvents.id))
      .all();
    let timelineGrowth = 0;
    let timelinePieces = 0;
    let previousMilestonePieces = 0;
    let nextMilestoneLevel = 10;
    const cumulativeCategories = new Set<string>();
    for (const event of timeline) {
      timelineGrowth += event.growthDelta;
      timelinePieces += event.collectedPieceDelta;
      if (event.growthDelta > 0 && event.category) cumulativeCategories.add(event.category);
      while (
        nextMilestoneLevel <= milestoneLevel &&
        timelineGrowth >= progressionThreshold(nextMilestoneLevel)
      ) {
        if (!savedMilestoneLevels.has(nextMilestoneLevel)) {
          newMilestones.push({
            level: nextMilestoneLevel,
            reachedAt: event.occurredAt,
            collectedPiecesDelta: Math.max(0, timelinePieces - previousMilestonePieces),
            collectedPiecesTotal: timelinePieces,
            categoriesJson: JSON.stringify([...cumulativeCategories].sort()),
          });
        }
        previousMilestonePieces =
          savedMilestonesByLevel.get(nextMilestoneLevel)?.collectedPiecesTotal ?? timelinePieces;
        nextMilestoneLevel += 10;
      }
    }
    while (nextMilestoneLevel <= milestoneLevel) {
      if (!savedMilestoneLevels.has(nextMilestoneLevel)) {
        newMilestones.push({
          level: nextMilestoneLevel,
          reachedAt: at,
          collectedPiecesDelta: Math.max(0, collectedPieces - previousMilestonePieces),
          collectedPiecesTotal: collectedPieces,
          categoriesJson: JSON.stringify(categories),
        });
      }
      previousMilestonePieces =
        savedMilestonesByLevel.get(nextMilestoneLevel)?.collectedPiecesTotal ?? collectedPieces;
      nextMilestoneLevel += 10;
    }
    await db.batch(
      newMilestones.map((milestone) =>
        db
          .insert(progressionMilestones)
          .values({
            id: `progression:milestone:v1:${accountId}:${milestone.level}`,
            accountId,
            level: milestone.level,
            collectedPiecesDelta: milestone.collectedPiecesDelta,
            collectedPiecesTotal: milestone.collectedPiecesTotal,
            categoriesJson: milestone.categoriesJson,
            createdAt: milestone.reachedAt,
            updatedAt: milestone.reachedAt,
          })
          .onConflictDoNothing(),
      ),
    );
  }
  const milestoneCards = [...newMilestones, ...savedMilestones]
    .sort((left, right) => right.level - left.level)
    .slice(0, 4);
  return {
    level,
    growthValue,
    currentLevelThreshold: progressionThreshold(level),
    nextLevelThreshold: progressionThreshold(level + 1),
    collectedPieces,
    activePieces: activeCategories.reduce((sum, row) => sum + row.activePieces, 0),
    categoryCount: activeCategories.length,
    calculationVersion: totals.calculationVersion,
    highestLevel: totals.highestLevel,
    isProcessing: Boolean(pendingProjection),
    recentChanges: recentEvents.flatMap((event): UtsushiProgressionChange[] => {
      const kind =
        event.kind === "new_item"
          ? "new_piece"
          : event.kind === "evidence_added"
            ? "evidence_deepened"
            : event.kind === "temporal_revision"
              ? "temporal_change"
              : null;
      return kind
        ? [{ kind, growthDelta: event.growthDelta, occurredAt: event.occurredAt.toISOString() }]
        : [];
    }),
    milestoneCards: milestoneCards.slice(0, 3).map((milestone) => ({
      level: milestone.level,
      reachedAt: milestone.reachedAt.toISOString(),
      collectedPiecesDelta: milestone.collectedPiecesDelta,
    })),
  };
}
