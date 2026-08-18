import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type {
  RevokeSelfCareConfirmationResult,
  SelfCareConfirmation,
  SelfCareConfirmationKind,
  SelfCareConfirmationResult,
  SelfCareContextReadModel,
} from "../../../self-care-context";
import type { AccountDataDatabase } from "../database";
import { brainItemEvidenceEdges, brainItems } from "../schema/brain";
import { sourceRecordTextPayloads } from "../schema/diary";
import { selfCareConfirmations } from "../schema/self-care-context";
import { sourceRecords } from "../schema/source";
import type { BrainChatContextMemory } from "./brain";

function isInference(attributes: unknown, derivation: "ai" | "deterministic"): boolean {
  return attributes &&
    typeof attributes === "object" &&
    "isInference" in attributes &&
    typeof attributes.isInference === "boolean"
    ? attributes.isInference
    : derivation === "ai";
}

const toModel = (row: {
  id: string;
  brainItemId: string;
  statement: string;
  kind: SelfCareConfirmationKind;
  status: "active" | "revoked";
  confirmedAt: Date;
  updatedAt: Date;
}): SelfCareConfirmation => ({
  ...row,
  confirmedAt: row.confirmedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export async function readSelfCareConfirmations(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<SelfCareContextReadModel> {
  const itemRows = await db
    .select({
      id: selfCareConfirmations.id,
      brainItemId: selfCareConfirmations.brainItemId,
      statement: brainItems.statement,
      kind: selfCareConfirmations.kind,
      status: selfCareConfirmations.status,
      confirmedAt: selfCareConfirmations.confirmedAt,
      updatedAt: selfCareConfirmations.updatedAt,
    })
    .from(selfCareConfirmations)
    .innerJoin(brainItems, eq(brainItems.id, selfCareConfirmations.brainItemId))
    .where(
      and(
        eq(selfCareConfirmations.accountId, accountId),
        eq(selfCareConfirmations.status, "active"),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .orderBy(desc(selfCareConfirmations.updatedAt))
    .limit(100)
    .all();
  return { items: itemRows.map(toModel) };
}

export async function confirmSelfCareContext(
  db: AccountDataDatabase,
  accountId: string,
  brainItemId: string,
  kind: SelfCareConfirmationKind,
  at = new Date(),
): Promise<SelfCareConfirmationResult> {
  const item = await db
    .select({
      id: brainItems.id,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
    })
    .from(brainItems)
    .where(
      and(
        eq(brainItems.id, brainItemId),
        eq(brainItems.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .get();
  if (!item) return { type: "brain-item-not-found" };
  if (isInference(item.attributes, item.derivation)) return { type: "not-confirmed" };

  await db
    .insert(selfCareConfirmations)
    .values({
      id: crypto.randomUUID(),
      accountId,
      brainItemId,
      kind,
      status: "active",
      confirmedAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [
        selfCareConfirmations.accountId,
        selfCareConfirmations.brainItemId,
        selfCareConfirmations.kind,
      ],
      set: { status: "active", confirmedAt: at, updatedAt: at },
    });
  const confirmed = (await readSelfCareConfirmations(db, accountId, at)).items.find(
    (candidate) => candidate.brainItemId === brainItemId && candidate.kind === kind,
  );
  if (!confirmed) throw new Error("Self-care confirmation was not persisted");
  return { type: "confirmed", item: confirmed };
}

export async function revokeSelfCareContext(
  db: AccountDataDatabase,
  accountId: string,
  id: string,
  at = new Date(),
): Promise<RevokeSelfCareConfirmationResult> {
  const existing = (await readSelfCareConfirmations(db, accountId, at)).items.find(
    (candidate) => candidate.id === id,
  );
  if (!existing) return { type: "not-found" };
  const updated = await db
    .update(selfCareConfirmations)
    .set({ status: "revoked", updatedAt: at })
    .where(and(eq(selfCareConfirmations.id, id), eq(selfCareConfirmations.accountId, accountId)))
    .returning({ id: selfCareConfirmations.id })
    .get();
  if (!updated) return { type: "not-found" };
  return {
    type: "revoked",
    item: { ...existing, status: "revoked", updatedAt: at.toISOString() },
  };
}

const LIMITS = {
  confirmed: { worked: 1, "did-not-work": 1, "recent-state": 1 },
  "personalized-history": { worked: 3, "did-not-work": 3, "recent-state": 2 },
} as const;
const RECENT_STATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

export async function selectSelfCareContextMemories(
  db: AccountDataDatabase,
  accountId: string,
  mode: "general" | "confirmed" | "personalized-history",
  at = new Date(),
): Promise<BrainChatContextMemory[]> {
  if (mode === "general") return [];
  const rows = await db
    .select({
      confirmationId: selfCareConfirmations.id,
      brainItemId: brainItems.id,
      category: brainItems.category,
      statement: brainItems.statement,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
      confidence: brainItems.confidence,
      firstObservedAt: brainItems.createdAt,
      lastObservedAt: selfCareConfirmations.updatedAt,
      kind: selfCareConfirmations.kind,
      sourceRecordId: sourceRecords.id,
      text: sourceRecordTextPayloads.body,
      recordedAt: sourceRecords.createdAt,
    })
    .from(selfCareConfirmations)
    .innerJoin(brainItems, eq(brainItems.id, selfCareConfirmations.brainItemId))
    .innerJoin(
      brainItemEvidenceEdges,
      and(
        eq(brainItemEvidenceEdges.brainItemId, brainItems.id),
        eq(brainItemEvidenceEdges.relation, "supports"),
        eq(brainItemEvidenceEdges.isDeleted, false),
      ),
    )
    .innerJoin(
      sourceRecords,
      and(
        eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId),
        eq(sourceRecords.accountId, accountId),
        eq(sourceRecords.isDeleted, false),
      ),
    )
    .innerJoin(
      sourceRecordTextPayloads,
      eq(sourceRecordTextPayloads.sourceRecordId, sourceRecords.id),
    )
    .where(
      and(
        eq(selfCareConfirmations.accountId, accountId),
        eq(selfCareConfirmations.status, "active"),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .orderBy(desc(selfCareConfirmations.updatedAt), asc(sourceRecords.createdAt))
    .all();

  const grouped = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    if (
      row.kind === "recent-state" &&
      row.lastObservedAt.getTime() < at.getTime() - RECENT_STATE_WINDOW_MS
    ) {
      continue;
    }
    grouped.set(row.confirmationId, [...(grouped.get(row.confirmationId) ?? []), row]);
  }
  const used = { worked: 0, "did-not-work": 0, "recent-state": 0 };
  const selected: BrainChatContextMemory[] = [];
  for (const confirmation of grouped.values()) {
    const first = confirmation[0];
    if (!first || isInference(first.attributes, first.derivation)) continue;
    if (used[first.kind] >= LIMITS[mode][first.kind]) continue;
    used[first.kind] += 1;
    const label = `self-care-${first.kind}`;
    selected.push({
      brainItemId: first.brainItemId,
      category: first.category,
      statement: first.statement,
      derivation: first.derivation,
      isInference: false,
      status: "active",
      confidence: first.confidence,
      accessLabels: [label],
      firstObservedAt: first.firstObservedAt,
      lastObservedAt: first.lastObservedAt,
      evidence: confirmation.map(({ sourceRecordId, text, recordedAt }) => ({
        sourceRecordId,
        text,
        recordedAt,
      })),
    });
  }
  return selected;
}
