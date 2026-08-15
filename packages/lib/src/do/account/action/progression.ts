import { and, asc, count, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import {
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItems,
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
  categories: readonly string[];
}>;

function readStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

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

function growthForKind(kind: ProgressionEventKind): number {
  if (kind === "new_item") return 3;
  if (kind === "evidence_added") return 1;
  if (kind === "temporal_revision") return 2;
  return 0;
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

/** Brain側で意味的重複と確定したEvidenceを、将来の初期集計でも加点対象外に固定する。 */
export function progressionIgnoredEvidenceStatement(
  db: AccountDataDatabase,
  input: Readonly<{ accountId: string; evidenceId: string; at: Date }>,
): D1BatchStatement {
  return eventStatement(db, {
    accountId: input.accountId,
    originType: "evidence",
    originId: input.evidenceId,
    kind: "duplicate_evidence",
    growthDelta: 0,
    collectedPieceDelta: 0,
    at: input.at,
  });
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
      calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
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
    deletedAt?: Date | null;
    updatedAt?: Date;
    validFrom: Date | null;
    validTo: Date | null;
  }>,
  at: Date,
): boolean {
  return (
    (item.status === "active" || Boolean(item.updatedAt && item.updatedAt > at)) &&
    (!item.isDeleted || Boolean(item.deletedAt && item.deletedAt > at)) &&
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
      attributes: unknown;
      derivation: "ai" | "deterministic";
      status: "active" | "superseded" | "invalidated";
      isDeleted: boolean;
      deletedAt?: Date | null;
      updatedAt?: Date;
      validFrom: Date | null;
      validTo: Date | null;
    };
    revisionKind: "correction" | "temporal" | null;
    initialization: boolean;
    at: Date;
    occurredAt?: Date;
  }>,
): Readonly<{ statement: D1BatchStatement; growthDelta: number; collectedPieceDelta: number }> {
  const inference = isInference(input.item.attributes, input.item.derivation);
  const temporalRevision = input.revisionKind === "temporal";
  const availableAtEvent = isAvailableItem(input.item, input.at);
  const growthDelta = !availableAtEvent
    ? 0
    : temporalRevision
      ? 2
      : input.revisionKind || inference
        ? 0
        : 3;
  const kind: ProgressionEventKind = temporalRevision
    ? "temporal_revision"
    : input.revisionKind
      ? "correction_revision"
      : inference
        ? "inference_item"
        : "new_item";
  const collectedPieceDelta = availableAtEvent ? 1 : 0;
  return {
    statement: eventStatement(db, {
      accountId: input.accountId,
      originType: "brain_item",
      originId: input.item.id,
      kind,
      growthDelta,
      collectedPieceDelta,
      at: input.occurredAt ?? input.at,
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
        attributes: brainItems.attributes,
        derivation: brainItems.derivation,
        status: brainItems.status,
        isDeleted: brainItems.isDeleted,
        deletedAt: brainItems.deletedAt,
        updatedAt: brainItems.updatedAt,
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
        itemDerivation: brainItems.derivation,
        itemStatus: brainItems.status,
        itemIsDeleted: brainItems.isDeleted,
        itemDeletedAt: brainItems.deletedAt,
        itemUpdatedAt: brainItems.updatedAt,
        itemValidFrom: brainItems.validFrom,
        itemValidTo: brainItems.validTo,
        occurredAt: brainItemEvidenceEdges.createdAt,
        progressionEventId: progressionEvents.id,
        progressionEventKind: progressionEvents.kind,
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
    if (evidence.progressionEventKind === "duplicate_evidence") continue;
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
    const kind: ProgressionEventKind = duplicate
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
        at,
        occurredAt: item.occurredAt,
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
    const events = await db
      .select({ id: progressionEvents.id, kind: progressionEvents.kind })
      .from(progressionEvents)
      .where(
        and(eq(progressionEvents.accountId, accountId), eq(progressionEvents.isDeleted, false)),
      )
      .all();
    const growthValue = events.reduce((sum, event) => sum + growthForKind(event.kind), 0);
    const highestLevel = Math.max(state.highestLevel, progressionLevel(growthValue));
    const updates = events.map((event) =>
      db
        .update(progressionEvents)
        .set({
          calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
          growthDelta: growthForKind(event.kind),
          updatedAt: at,
        })
        .where(eq(progressionEvents.id, event.id)),
    );
    const stateUpdate = db
      .update(progressionStates)
      .set({
        growthValue,
        calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
        highestLevel,
        updatedAt: at,
      })
      .where(eq(progressionStates.accountId, accountId));
    await db.batch([stateUpdate, ...updates]);
    state = {
      ...state,
      growthValue,
      calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
      highestLevel,
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
        attributes: brainItems.attributes,
        derivation: brainItems.derivation,
        status: brainItems.status,
        isDeleted: brainItems.isDeleted,
        deletedAt: brainItems.deletedAt,
        updatedAt: brainItems.updatedAt,
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
        itemDerivation: brainItems.derivation,
        itemStatus: brainItems.status,
        itemIsDeleted: brainItems.isDeleted,
        itemDeletedAt: brainItems.deletedAt,
        itemUpdatedAt: brainItems.updatedAt,
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
      at: item.occurredAt,
      occurredAt: item.occurredAt,
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
          deletedAt: evidence.itemDeletedAt,
          updatedAt: evidence.itemUpdatedAt,
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
    const kind: ProgressionEventKind = duplicate
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
  const [activeCategories, recentEvents, savedMilestones] = await Promise.all([
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
        id: progressionMilestones.id,
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
      .limit(4)
      .all(),
  ]);
  let retainedMilestones = savedMilestones;
  if (savedMilestones.length > 0) {
    const retainedCategoryRows = await db
      .select({ category: brainItems.category })
      .from(brainItems)
      .where(and(eq(brainItems.accountId, accountId), eq(brainItems.isDeleted, false)))
      .groupBy(brainItems.category)
      .all();
    const retainedCategories = new Set(retainedCategoryRows.map(({ category }) => category));
    const scrubStatements: D1BatchStatement[] = [];
    retainedMilestones = savedMilestones.map((milestone) => {
      const categories = readStringArray(milestone.categoriesJson).filter((category) =>
        retainedCategories.has(category),
      );
      const categoriesJson = JSON.stringify(categories);
      if (categoriesJson !== milestone.categoriesJson) {
        scrubStatements.push(
          db
            .update(progressionMilestones)
            .set({ categoriesJson, updatedAt: at })
            .where(eq(progressionMilestones.id, milestone.id)),
        );
      }
      return { ...milestone, categoriesJson };
    });
    if (scrubStatements.length > 0) {
      const [first, ...rest] = scrubStatements;
      if (first) await db.batch([first, ...rest]);
    }
  }
  const growthValue = totals.growthValue;
  const collectedPieces = totals.collectedPieces;
  const level = Math.max(progressionLevel(growthValue), totals.highestLevel);
  const categories = activeCategories.map(({ category }) => category);
  const milestoneLevel = Math.floor(level / 10) * 10;
  const latestSavedMilestone = retainedMilestones[0];
  const shouldSaveMilestone =
    milestoneLevel >= 10 && (latestSavedMilestone?.level ?? 0) < milestoneLevel;
  let milestoneReachedAt = at;
  if (shouldSaveMilestone) {
    const growthEvents = await db
      .select({
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
      .orderBy(asc(progressionEvents.createdAt), asc(progressionEvents.id))
      .all();
    let accumulatedGrowth = 0;
    for (const event of growthEvents) {
      accumulatedGrowth += event.growthDelta;
      if (accumulatedGrowth >= progressionThreshold(milestoneLevel)) {
        milestoneReachedAt = event.occurredAt;
        break;
      }
    }
  }
  const newMilestone = shouldSaveMilestone
    ? {
        level: milestoneLevel,
        reachedAt: milestoneReachedAt,
        collectedPiecesDelta: Math.max(
          0,
          collectedPieces - (latestSavedMilestone?.collectedPiecesTotal ?? 0),
        ),
        collectedPiecesTotal: collectedPieces,
        categoriesJson: JSON.stringify(categories),
      }
    : null;
  if (newMilestone) {
    await db
      .insert(progressionMilestones)
      .values({
        id: `progression:milestone:v1:${accountId}:${newMilestone.level}`,
        accountId,
        level: newMilestone.level,
        collectedPiecesDelta: newMilestone.collectedPiecesDelta,
        collectedPiecesTotal: newMilestone.collectedPiecesTotal,
        categoriesJson: newMilestone.categoriesJson,
        createdAt: newMilestone.reachedAt,
        updatedAt: newMilestone.reachedAt,
      })
      .onConflictDoNothing();
  }
  const milestoneCards = [
    ...(newMilestone ? [newMilestone] : []),
    ...retainedMilestones.filter(({ level: savedLevel }) => savedLevel !== newMilestone?.level),
  ].slice(0, 4);
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
    milestoneCards: milestoneCards.slice(0, 3).map((milestone, index) => {
      const previousCategories = new Set(
        readStringArray(milestoneCards[index + 1]?.categoriesJson ?? "[]"),
      );
      return {
        level: milestone.level,
        reachedAt: milestone.reachedAt.toISOString(),
        collectedPiecesDelta: milestone.collectedPiecesDelta,
        categories: readStringArray(milestone.categoriesJson).filter(
          (category) => !previousCategories.has(category),
        ),
      };
    }),
  };
}
