import { and, desc, eq, exists, gt, isNull, lte, notExists, or } from "drizzle-orm";
import type {
  AgreeGoalFollowUpResult,
  GoalFollowUp,
  GoalFollowUpReadModel,
  GoalFollowUpStatus,
  UpdateGoalFollowUpResult,
} from "../../../goal-follow-up";
import type { AccountDataDatabase } from "../database";
import { brainItemEvidenceEdges, brainItems } from "../schema/brain";
import { sourceRecordTextPayloads } from "../schema/diary";
import { goalFollowUps } from "../schema/goal-follow-up";
import { sourceRecords } from "../schema/source";
import type { BrainChatContextMemory } from "./brain";

const toModel = (row: {
  id: string;
  brainItemId: string;
  goal: string;
  nextStep: string;
  status: GoalFollowUpStatus;
  agreedAt: Date;
  updatedAt: Date;
}): GoalFollowUp => ({
  ...row,
  agreedAt: row.agreedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

function isInference(attributes: unknown, derivation: "ai" | "deterministic"): boolean {
  return attributes &&
    typeof attributes === "object" &&
    "isInference" in attributes &&
    typeof attributes.isInference === "boolean"
    ? attributes.isInference
    : derivation === "ai";
}

export async function readGoalFollowUps(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
  includeCandidates = false,
): Promise<GoalFollowUpReadModel> {
  const itemRows = await db
    .select({
      id: goalFollowUps.id,
      brainItemId: goalFollowUps.brainItemId,
      goal: brainItems.statement,
      nextStep: goalFollowUps.nextStep,
      status: goalFollowUps.status,
      agreedAt: goalFollowUps.agreedAt,
      updatedAt: goalFollowUps.updatedAt,
    })
    .from(goalFollowUps)
    .innerJoin(brainItems, eq(brainItems.id, goalFollowUps.brainItemId))
    .where(
      and(
        eq(goalFollowUps.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .orderBy(desc(goalFollowUps.updatedAt))
    .limit(100)
    .all();
  if (!includeCandidates) return { items: itemRows.map(toModel), candidates: [] };
  const candidateRows = await db
    .select({
      brainItemId: brainItems.id,
      goal: brainItems.statement,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
    })
    .from(brainItems)
    .where(
      and(
        eq(brainItems.accountId, accountId),
        eq(brainItems.category, "goal"),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
        notExists(
          db
            .select({ id: goalFollowUps.id })
            .from(goalFollowUps)
            .where(
              and(
                eq(goalFollowUps.accountId, accountId),
                eq(goalFollowUps.brainItemId, brainItems.id),
                eq(goalFollowUps.status, "active"),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(brainItems.updatedAt))
    .limit(100)
    .all();
  return {
    items: itemRows.map(toModel),
    candidates: candidateRows
      .filter(({ attributes, derivation }) => !isInference(attributes, derivation))
      .map(({ brainItemId, goal }) => ({ brainItemId, goal }))
      .slice(0, 20),
  };
}

export async function agreeGoalFollowUp(
  db: AccountDataDatabase,
  accountId: string,
  brainItemId: string,
  nextStep: string,
  at = new Date(),
  activeLimit: number | null = null,
): Promise<AgreeGoalFollowUpResult> {
  const normalized = nextStep.trim();
  if (!normalized || normalized.length > 500) return { type: "goal-not-confirmed" };
  const goal = await db
    .select({
      id: brainItems.id,
      statement: brainItems.statement,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
    })
    .from(brainItems)
    .where(
      and(
        eq(brainItems.id, brainItemId),
        eq(brainItems.accountId, accountId),
        eq(brainItems.category, "goal"),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .get();
  if (!goal) return { type: "goal-not-found" };
  if (isInference(goal.attributes, goal.derivation)) return { type: "goal-not-confirmed" };
  if (activeLimit !== null) {
    const active = await db
      .select({ brainItemId: goalFollowUps.brainItemId })
      .from(goalFollowUps)
      .innerJoin(brainItems, eq(brainItems.id, goalFollowUps.brainItemId))
      .where(
        and(
          eq(goalFollowUps.accountId, accountId),
          eq(goalFollowUps.status, "active"),
          eq(brainItems.status, "active"),
          eq(brainItems.isDeleted, false),
          or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
          or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
        ),
      )
      .all();
    if (active.filter((candidate) => candidate.brainItemId !== brainItemId).length >= activeLimit) {
      return { type: "active-limit-reached" };
    }
  }
  const id = crypto.randomUUID();
  await db
    .insert(goalFollowUps)
    .values({
      id,
      accountId,
      brainItemId,
      nextStep: normalized,
      status: "active",
      agreedAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [goalFollowUps.accountId, goalFollowUps.brainItemId],
      set: { nextStep: normalized, status: "active", agreedAt: at, updatedAt: at },
    });
  const item = (await readGoalFollowUps(db, accountId, at)).items.find(
    (candidate) => candidate.brainItemId === brainItemId,
  );
  if (!item) throw new Error("Goal follow-up was not persisted");
  return { type: "agreed", item };
}

export async function updateGoalFollowUp(
  db: AccountDataDatabase,
  accountId: string,
  id: string,
  input: Readonly<{ status?: GoalFollowUpStatus; nextStep?: string }>,
  at = new Date(),
  activeLimit: number | null = null,
): Promise<UpdateGoalFollowUpResult> {
  const nextStep = input.nextStep?.trim();
  if (nextStep !== undefined && (!nextStep || nextStep.length > 500)) return { type: "not-found" };
  if (input.status === "active" && activeLimit !== null) {
    const active = await db
      .select({ id: goalFollowUps.id })
      .from(goalFollowUps)
      .innerJoin(brainItems, eq(brainItems.id, goalFollowUps.brainItemId))
      .where(
        and(
          eq(goalFollowUps.accountId, accountId),
          eq(goalFollowUps.status, "active"),
          eq(brainItems.status, "active"),
          eq(brainItems.isDeleted, false),
          or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
          or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
        ),
      )
      .all();
    if (active.filter((candidate) => candidate.id !== id).length >= activeLimit) {
      return { type: "active-limit-reached" };
    }
  }
  const updated = await db
    .update(goalFollowUps)
    .set({
      ...(input.status ? { status: input.status } : {}),
      ...(nextStep ? { nextStep } : {}),
      updatedAt: at,
    })
    .where(
      and(
        eq(goalFollowUps.id, id),
        eq(goalFollowUps.accountId, accountId),
        exists(
          db
            .select({ id: brainItems.id })
            .from(brainItems)
            .where(
              and(
                eq(brainItems.id, goalFollowUps.brainItemId),
                eq(brainItems.accountId, accountId),
                eq(brainItems.status, "active"),
                eq(brainItems.isDeleted, false),
                or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
                or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
              ),
            ),
        ),
      ),
    )
    .returning({ id: goalFollowUps.id })
    .get();
  if (!updated) return { type: "not-found" };
  const item = (await readGoalFollowUps(db, accountId, at)).items.find(
    (candidate) => candidate.id === id,
  );
  if (!item) return { type: "not-found" };
  return { type: "updated", item };
}

function overlapScore(currentText: string, goal: string, nextStep: string): number {
  const compact = (value: string) => value.replace(/[\s、。！？,.!?]/g, "").toLowerCase();
  const current = compact(currentText);
  const target = compact(`${goal}${nextStep}`);
  const chunks = new Set<string>();
  for (let index = 0; index < current.length - 1; index += 1) {
    chunks.add(current.slice(index, index + 2));
  }
  return [...chunks].filter((chunk) => target.includes(chunk)).length;
}

export async function selectGoalFollowUpMemory(
  db: AccountDataDatabase,
  accountId: string,
  mode: "none" | "selected-one" | "relevant-active",
  currentText: string,
  at = new Date(),
): Promise<BrainChatContextMemory | null> {
  if (mode === "none") return null;
  const rows = await db
    .select({
      id: goalFollowUps.id,
      brainItemId: goalFollowUps.brainItemId,
      goal: brainItems.statement,
      nextStep: goalFollowUps.nextStep,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
      confidence: brainItems.confidence,
      createdAt: brainItems.createdAt,
      updatedAt: goalFollowUps.updatedAt,
      sourceRecordId: sourceRecords.id,
      sourceText: sourceRecordTextPayloads.body,
      recordedAt: sourceRecords.createdAt,
    })
    .from(goalFollowUps)
    .innerJoin(brainItems, eq(brainItems.id, goalFollowUps.brainItemId))
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
        eq(goalFollowUps.accountId, accountId),
        eq(goalFollowUps.status, "active"),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
        gt(sourceRecords.createdAt, new Date(0)),
      ),
    )
    .orderBy(desc(goalFollowUps.updatedAt), desc(sourceRecords.createdAt))
    .all();
  const grouped = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
  const candidates = [...grouped.values()];
  const selected =
    mode === "selected-one"
      ? candidates[0]
      : candidates
          .map((candidate) => ({
            candidate,
            score: overlapScore(
              currentText,
              candidate[0]?.goal ?? "",
              candidate[0]?.nextStep ?? "",
            ),
          }))
          .filter(({ score }) => score > 0)
          .sort((left, right) => right.score - left.score)[0]?.candidate;
  const first = selected?.[0];
  if (!first || isInference(first.attributes, first.derivation)) return null;
  return {
    brainItemId: first.brainItemId,
    category: "goal",
    statement: `継続中のGoal: ${first.goal}。本人が選んだ次の一歩: ${first.nextStep}`,
    derivation: first.derivation,
    isInference: false,
    status: "active",
    confidence: first.confidence,
    accessLabels: ["goal-follow-up"],
    firstObservedAt: first.createdAt,
    lastObservedAt: first.updatedAt,
    evidence: selected.map((row) => ({
      sourceRecordId: row.sourceRecordId,
      text: row.sourceText,
      recordedAt: row.recordedAt,
    })),
  };
}
