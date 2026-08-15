import { and, asc, desc, eq, gt, inArray, isNull, lte, max, min, or, sql } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import {
  type DailyPromptLocalHour,
  type DailyPromptStrategy,
  PROMPT_CONTEXT_ATTRIBUTE_MASTER,
  type PromptContextKind,
  type PromptContextWeekday,
  dailyPromptLocalHourFromRestWindow,
  dailyPromptStrategyFromQuestionStyle,
  readPromptContext,
} from "../prompt-context";
import {
  brainItemAccessLabels,
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItemTopicLabels,
  brainItems,
  brainVectorEntries,
  brainVectorSyncJobs,
} from "../schema/brain";
import { sourceRecordTextPayloads } from "../schema/diary";
import { sourceRecords } from "../schema/source";
import { buildDiaryTemporalSearchText, readDiaryTemporalContext } from "./diary-temporal";
import { progressionPendingStatement } from "./progression";

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
const DEVELOPMENT_FAILED_VECTOR_SYNC_JOB_LIMIT = 100;
const CHAT_CONTEXT_VECTOR_CANDIDATE_LIMIT = 10;
const CHAT_CONTEXT_MEMORY_LIMIT = 5;
const CHAT_CONTEXT_EVIDENCE_LIMIT = 3;
const SEMANTIC_DEDUP_VECTOR_CANDIDATE_LIMIT = 30;
const SEMANTIC_DEDUP_RECENT_CANDIDATE_LIMIT = 20;
const SEMANTIC_DEDUP_CANDIDATE_LIMIT = 30;
const SEMANTIC_DEDUP_RECENT_RESERVED_LIMIT = 10;
const SEMANTIC_DEDUP_COMPARISON_TEXT_LIMIT = 1_500;
const VECTOR_SYNC_DISPATCH_RETRY_MS = 15 * 60 * 1000;
export const BRAIN_VECTOR_SYNC_MAX_ATTEMPTS = 6;
const VECTOR_SYNC_FAILURE_RETRY_DELAYS_MS = [
  60 * 1000,
  2 * 60 * 1000,
  8 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
] as const;

export type ActiveBrainItemList = Readonly<{
  items: readonly Readonly<{
    id: string;
    category: string;
    statement: string;
    derivation: "ai" | "deterministic";
    status: "active";
    createdAt: Date;
    firstObservedAt: Date;
    lastObservedAt: Date;
    vectorSync: Readonly<{
      status: "pending" | "submitted" | "retry_scheduled" | "applied" | "failed" | "not-scheduled";
      operation?: "upsert" | "delete";
      attemptCount: number;
      updatedAt?: Date;
      nextAttemptAt?: Date;
      failureCode?: string;
      hasEntry: boolean;
      entryRevision?: number;
    }>;
    evidence: readonly Readonly<{
      sourceRecordId: string;
      relation: "supports" | "contradicts";
      derivationMethod: "ai" | "deterministic";
      generatedAt: Date;
      recordedAt: Date;
    }>[];
  }>[];
  truncated: boolean;
}>;

export type BrainChatContextMemory = Readonly<{
  brainItemId: string;
  category: string;
  statement: string;
  derivation: "ai" | "deterministic";
  /** Brain Itemの生成方法とは独立した、命題に未明言の推定が含まれるかどうか。 */
  isInference: boolean;
  status: "active";
  confidence: unknown;
  accessLabels: readonly string[];
  firstObservedAt: Date;
  lastObservedAt: Date;
  evidence: readonly Readonly<{
    sourceRecordId: string;
    text: string;
    recordedAt: Date;
  }>[];
}>;

export type BrainSemanticDedupCandidate = Readonly<{
  brainItemId: string;
  category: string;
  statement: string;
  comparisonText: string;
  isInference: boolean;
}>;

/** 通知へ予定名や本文を出さず、曜日に合う定型文だけを選ぶための区分。 */
export type DailyPromptWeekdayContext = "recurring_schedule" | "day_off" | "active_day";

/** 現在有効な本人の明言だけから、日次声かけのレビュー済み方針を返す。 */
export async function selectDailyPromptStrategyPreference(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<DailyPromptStrategy | undefined> {
  const rows = await db
    .select({
      category: brainItems.category,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
    })
    .from(brainItems)
    .innerJoin(
      brainItemAccessLabels,
      and(
        eq(brainItemAccessLabels.brainItemId, brainItems.id),
        eq(brainItemAccessLabels.isDeleted, false),
      ),
    )
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
    .where(
      and(
        eq(brainItems.accountId, accountId),
        eq(brainItems.category, "preference"),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .orderBy(desc(sourceRecords.createdAt), desc(brainItems.createdAt))
    .all();

  for (const row of rows) {
    if (brainItemIsInference(row.attributes, row.derivation)) continue;
    const promptContext = readPromptContext(row.attributes);
    if (promptContext?.kind !== "question_style") continue;
    const definition = PROMPT_CONTEXT_ATTRIBUTE_MASTER.find(
      ({ kind }) => kind === promptContext.kind,
    );
    if (definition?.category !== row.category) continue;
    return dailyPromptStrategyFromQuestionStyle(promptContext.style);
  }
  return undefined;
}

/** 現在有効な本人の明言を、許可済みの日次声かけ時刻へ写像する。 */
export async function selectDailyPromptTimePreference(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<DailyPromptLocalHour | undefined> {
  const rows = await db
    .select({
      category: brainItems.category,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
    })
    .from(brainItems)
    .innerJoin(
      brainItemAccessLabels,
      and(
        eq(brainItemAccessLabels.brainItemId, brainItems.id),
        eq(brainItemAccessLabels.isDeleted, false),
      ),
    )
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
    .where(
      and(
        eq(brainItems.accountId, accountId),
        eq(brainItems.category, "preference"),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .orderBy(desc(sourceRecords.createdAt), desc(brainItems.createdAt))
    .all();

  for (const row of rows) {
    if (brainItemIsInference(row.attributes, row.derivation)) continue;
    const promptContext = readPromptContext(row.attributes);
    if (promptContext?.kind !== "rest_window") continue;
    const definition = PROMPT_CONTEXT_ATTRIBUTE_MASTER.find(
      ({ kind }) => kind === promptContext.kind,
    );
    if (definition?.category !== row.category) continue;
    return dailyPromptLocalHourFromRestWindow(promptContext);
  }
  return undefined;
}

/** 自然な確認質問の重複を避けるため、現在利用できる声かけ属性のkindだけを返す。 */
export async function listActivePromptContextKinds(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<readonly PromptContextKind[]> {
  const rows = await db
    .select({ attributes: brainItems.attributes })
    .from(brainItems)
    .innerJoin(
      brainItemAccessLabels,
      and(
        eq(brainItemAccessLabels.brainItemId, brainItems.id),
        eq(brainItemAccessLabels.isDeleted, false),
      ),
    )
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
    .where(
      and(
        eq(brainItems.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .all();
  const collected = new Set(
    rows.flatMap(({ attributes }) => {
      const promptContext = readPromptContext(attributes);
      return promptContext ? [promptContext.kind] : [];
    }),
  );
  return PROMPT_CONTEXT_ATTRIBUTE_MASTER.map(({ kind }) => kind).filter((kind) =>
    collected.has(kind),
  );
}

/**
 * 現在利用できる明言済みの曜日情報を再検証し、通知に必要な区分を1件だけ返す。
 * 予定名、Brain Item ID、Evidence IDはAccountDataの外へ返さない。
 */
export async function selectDailyPromptWeekdayContext(
  db: AccountDataDatabase,
  accountId: string,
  weekday: PromptContextWeekday,
  at = new Date(),
): Promise<DailyPromptWeekdayContext | undefined> {
  const rows = await db
    .select({
      category: brainItems.category,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
    })
    .from(brainItems)
    .innerJoin(
      brainItemAccessLabels,
      and(
        eq(brainItemAccessLabels.brainItemId, brainItems.id),
        eq(brainItemAccessLabels.isDeleted, false),
      ),
    )
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
    .where(
      and(
        eq(brainItems.accountId, accountId),
        eq(brainItems.category, "behavior_pattern"),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .all();

  let hasDayOff = false;
  let hasActiveDay = false;
  for (const row of rows) {
    if (brainItemIsInference(row.attributes, row.derivation)) continue;
    const promptContext = readPromptContext(row.attributes);
    if (!promptContext) continue;
    const definition = PROMPT_CONTEXT_ATTRIBUTE_MASTER.find(
      ({ kind }) => kind === promptContext.kind,
    );
    if (definition?.category !== row.category) continue;
    if (promptContext.kind === "recurring_schedule" && promptContext.weekdays.includes(weekday)) {
      return "recurring_schedule";
    }
    if (promptContext.kind !== "weekly_rhythm" || promptContext.scheduleMode !== "fixed_weekly") {
      continue;
    }
    if (promptContext.daysOff?.includes(weekday)) hasDayOff = true;
    if (promptContext.activeWeekdays?.includes(weekday)) hasActiveDay = true;
  }
  if (hasDayOff) return "day_off";
  return hasActiveDay ? "active_day" : undefined;
}

function brainItemIsInference(attributes: unknown, derivation: "ai" | "deterministic"): boolean {
  return attributes &&
    typeof attributes === "object" &&
    "isInference" in attributes &&
    typeof attributes.isInference === "boolean"
    ? attributes.isInference
    : derivation === "ai";
}

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
  const changedAt = input.at ?? new Date();
  const lifecycle = { createdAt: changedAt, updatedAt: changedAt };
  const itemRevision = changedAt.getTime();
  const statements: D1BatchStatement[] = [
    db.insert(brainItems).values({ ...input.item, ...lifecycle }),
    progressionPendingStatement(db, {
      accountId,
      originType: "brain_item",
      originId: brainItemId,
      at: changedAt,
    }),
    db.insert(brainVectorSyncJobs).values({
      id: `${brainItemId}:${itemRevision}:upsert`,
      brainItemId,
      itemRevision,
      operation: "upsert",
      status: "pending",
      nextAttemptAt: changedAt,
      ...lifecycle,
    }),
    ...input.evidence.flatMap((edge) => [
      db.insert(brainItemEvidenceEdges).values({ ...edge, ...lifecycle, brainItemId }),
      progressionPendingStatement(db, {
        accountId,
        originType: "evidence",
        originId: edge.id,
        at: changedAt,
      }),
    ]),
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
        .set({ status: "superseded", updatedAt: changedAt })
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
      db.insert(brainVectorSyncJobs).values({
        id: `${input.supersedes.brainItemId}:${itemRevision}:delete`,
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

type BrainVectorSyncJob = Readonly<{
  id: string;
  brainItemId: string;
  itemRevision: number;
}>;

export type BrainVectorSyncClaimBatch = Readonly<{
  jobs: readonly BrainVectorSyncJob[];
  terminalFailures: readonly Readonly<{
    jobId: string;
    brainItemId: string;
    attemptCount: number;
    failureCode: string;
  }>[];
}>;

/** Alarm時点で期限を迎えたVector同期jobをclaimする。 */
export async function claimDueBrainVectorSyncJobs(
  db: AccountDataDatabase,
  at = new Date(),
): Promise<BrainVectorSyncClaimBatch> {
  const terminalFailures = await db
    .update(brainVectorSyncJobs)
    .set({
      status: "failed",
      failureCode: "BRAIN_VECTOR_SYNC_ATTEMPTS_EXHAUSTED",
      updatedAt: at,
    })
    .where(
      and(
        inArray(brainVectorSyncJobs.status, ["pending", "submitted", "retry_scheduled"]),
        lte(brainVectorSyncJobs.nextAttemptAt, at),
        sql`${brainVectorSyncJobs.attemptCount} >= ${BRAIN_VECTOR_SYNC_MAX_ATTEMPTS}`,
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .returning({
      jobId: brainVectorSyncJobs.id,
      brainItemId: brainVectorSyncJobs.brainItemId,
      attemptCount: brainVectorSyncJobs.attemptCount,
      failureCode: brainVectorSyncJobs.failureCode,
    })
    .all();
  const due = await db
    .select({
      id: brainVectorSyncJobs.id,
      brainItemId: brainVectorSyncJobs.brainItemId,
      itemRevision: brainVectorSyncJobs.itemRevision,
    })
    .from(brainVectorSyncJobs)
    .where(
      and(
        inArray(brainVectorSyncJobs.status, ["pending", "submitted", "retry_scheduled"]),
        sql`${brainVectorSyncJobs.attemptCount} < ${BRAIN_VECTOR_SYNC_MAX_ATTEMPTS}`,
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
          inArray(brainVectorSyncJobs.status, ["pending", "submitted", "retry_scheduled"]),
          sql`${brainVectorSyncJobs.attemptCount} < ${BRAIN_VECTOR_SYNC_MAX_ATTEMPTS}`,
          lte(brainVectorSyncJobs.nextAttemptAt, at),
          eq(brainVectorSyncJobs.isDeleted, false),
        ),
      )
      .returning({ id: brainVectorSyncJobs.id })
      .all();
    if (rows.length > 0) claimed.push(job);
  }
  return {
    jobs: claimed,
    terminalFailures: terminalFailures.map(({ jobId, brainItemId, attemptCount, failureCode }) => ({
      jobId,
      brainItemId,
      attemptCount,
      failureCode: failureCode ?? "BRAIN_VECTOR_SYNC_ATTEMPTS_EXHAUSTED",
    })),
  };
}

export type BrainVectorSyncTarget =
  | Readonly<{
      action: "upsert";
      embeddingText: string;
      category: string;
      derivation: "ai" | "deterministic";
      itemRevision: number;
      previousVectorId?: string;
    }>
  | Readonly<{ action: "delete"; vectorId?: string }>;

export type AppliedBrainVectorSync =
  | Readonly<{ action: "upsert"; vectorId: string; itemRevision: number }>
  | Readonly<{ action: "delete"; vectorId: string }>;

/** Queue本文を信頼せず、jobとBrain Itemの現在状態から操作を決める。 */
export async function getBrainVectorSyncTarget(
  db: AccountDataDatabase,
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
        eq(brainVectorSyncJobs.brainItemId, brainItemId),
        eq(brainVectorSyncJobs.itemRevision, itemRevision),
        eq(brainVectorSyncJobs.status, "submitted"),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .get();
  if (!job) return undefined;
  const [item, entry, newestJob] = await Promise.all([
    db
      .select({
        statement: brainItems.statement,
        attributes: brainItems.attributes,
        category: brainItems.category,
        derivation: brainItems.derivation,
        status: brainItems.status,
        isDeleted: brainItems.isDeleted,
        updatedAt: brainItems.updatedAt,
      })
      .from(brainItems)
      .where(and(eq(brainItems.id, brainItemId), eq(brainItems.accountId, accountId)))
      .get(),
    db
      .select({ vectorId: brainVectorEntries.id })
      .from(brainVectorEntries)
      .where(
        and(
          eq(brainVectorEntries.brainItemId, brainItemId),
          eq(brainVectorEntries.isDeleted, false),
        ),
      )
      .get(),
    db
      .select({ itemRevision: brainVectorSyncJobs.itemRevision })
      .from(brainVectorSyncJobs)
      .where(
        and(
          eq(brainVectorSyncJobs.brainItemId, brainItemId),
          eq(brainVectorSyncJobs.isDeleted, false),
        ),
      )
      .orderBy(desc(brainVectorSyncJobs.itemRevision))
      .limit(1)
      .get(),
  ]);
  if (!item || item.isDeleted || item.status !== "active") {
    return { action: "delete", ...(entry ? { vectorId: entry.vectorId } : {}) };
  }
  return {
    action: "upsert",
    embeddingText: buildDiaryTemporalSearchText(
      item.statement,
      readDiaryTemporalContext(item.attributes),
    ),
    category: item.category,
    derivation: item.derivation,
    itemRevision: Math.max(item.updatedAt.getTime(), newestJob?.itemRevision ?? itemRevision),
    ...(entry ? { previousVectorId: entry.vectorId } : {}),
  };
}

export async function completeBrainVectorSyncJob(
  db: AccountDataDatabase,
  accountId: string,
  jobId: string,
  applied: AppliedBrainVectorSync,
  mutationId: string,
  at = new Date(),
): Promise<boolean> {
  const job = await db
    .select({
      id: brainVectorSyncJobs.id,
      brainItemId: brainVectorSyncJobs.brainItemId,
      itemRevision: brainVectorSyncJobs.itemRevision,
    })
    .from(brainVectorSyncJobs)
    .where(
      and(
        eq(brainVectorSyncJobs.id, jobId),
        eq(brainVectorSyncJobs.status, "submitted"),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .get();
  if (!job) return false;

  const [item, newestJob] = await Promise.all([
    db
      .select({
        status: brainItems.status,
        isDeleted: brainItems.isDeleted,
        updatedAt: brainItems.updatedAt,
      })
      .from(brainItems)
      .where(and(eq(brainItems.id, job.brainItemId), eq(brainItems.accountId, accountId)))
      .get(),
    db
      .select({ itemRevision: brainVectorSyncJobs.itemRevision })
      .from(brainVectorSyncJobs)
      .where(
        and(
          eq(brainVectorSyncJobs.brainItemId, job.brainItemId),
          eq(brainVectorSyncJobs.isDeleted, false),
        ),
      )
      .orderBy(desc(brainVectorSyncJobs.itemRevision))
      .limit(1)
      .get(),
  ]);
  const isActive = Boolean(item && !item.isDeleted && item.status === "active");
  const desiredAction = isActive ? "upsert" : "delete";
  const desiredRevision = Math.max(
    item?.updatedAt.getTime() ?? 0,
    newestJob?.itemRevision ?? job.itemRevision,
  );
  const needsCorrection =
    applied.action !== desiredAction ||
    (applied.action === "upsert" && isActive && applied.itemRevision !== desiredRevision);
  const lifecycle = { createdAt: at, updatedAt: at };
  const completeStatement = db
    .update(brainVectorSyncJobs)
    .set({ status: "applied", mutationId, failureCode: null, updatedAt: at })
    .where(
      and(
        eq(brainVectorSyncJobs.id, jobId),
        eq(brainVectorSyncJobs.status, "submitted"),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    );
  const statements: D1BatchStatement[] = [];
  if (applied.action === "upsert") {
    statements.push(
      db
        .insert(brainVectorEntries)
        .values({
          id: applied.vectorId,
          brainItemId: job.brainItemId,
          itemRevision: applied.itemRevision,
          ...lifecycle,
        })
        .onConflictDoUpdate({
          target: brainVectorEntries.brainItemId,
          set: {
            id: applied.vectorId,
            itemRevision: applied.itemRevision,
            isDeleted: false,
            deletedAt: null,
            updatedAt: at,
          },
        }),
    );
  } else {
    statements.push(
      db
        .delete(brainVectorEntries)
        .where(
          and(
            eq(brainVectorEntries.id, applied.vectorId),
            eq(brainVectorEntries.brainItemId, job.brainItemId),
          ),
        ),
    );
  }
  if (needsCorrection) {
    statements.push(
      db
        .insert(brainVectorSyncJobs)
        .values({
          id: `${job.brainItemId}:${desiredRevision}:${desiredAction}`,
          brainItemId: job.brainItemId,
          itemRevision: desiredRevision,
          operation: desiredAction,
          status: "pending",
          nextAttemptAt: at,
          ...lifecycle,
        })
        .onConflictDoUpdate({
          target: [
            brainVectorSyncJobs.brainItemId,
            brainVectorSyncJobs.itemRevision,
            brainVectorSyncJobs.operation,
          ],
          set: {
            status: "pending",
            attemptCount: 0,
            mutationId: null,
            failureCode: null,
            nextAttemptAt: at,
            updatedAt: at,
          },
        }),
    );
  }
  await db.batch([completeStatement, ...statements]);
  return true;
}

export async function failBrainVectorSyncJob(
  db: AccountDataDatabase,
  jobId: string,
  failureCode: string,
  retryable = true,
  at = new Date(),
): Promise<BrainVectorSyncFailureResult | undefined> {
  const job = await db
    .select({ attemptCount: brainVectorSyncJobs.attemptCount })
    .from(brainVectorSyncJobs)
    .where(
      and(
        eq(brainVectorSyncJobs.id, jobId),
        eq(brainVectorSyncJobs.status, "submitted"),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .get();
  if (!job) return undefined;

  const terminal = !retryable || job.attemptCount >= BRAIN_VECTOR_SYNC_MAX_ATTEMPTS;
  const retryDelayMs = terminal ? 0 : VECTOR_SYNC_FAILURE_RETRY_DELAYS_MS[job.attemptCount - 1];
  if (!terminal && retryDelayMs === undefined) {
    throw new Error("Brain vector sync retry delay is not configured");
  }
  const nextAttemptAt = new Date(at.getTime() + (retryDelayMs ?? 0));
  const rows = await db
    .update(brainVectorSyncJobs)
    .set({
      status: terminal ? "failed" : "retry_scheduled",
      failureCode,
      nextAttemptAt,
      updatedAt: at,
    })
    .where(
      and(
        eq(brainVectorSyncJobs.id, jobId),
        eq(brainVectorSyncJobs.status, "submitted"),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .returning({ id: brainVectorSyncJobs.id })
    .all();
  if (rows.length === 0) return undefined;
  return terminal
    ? { outcome: "failed", attemptCount: job.attemptCount }
    : { outcome: "retry-scheduled", attemptCount: job.attemptCount, nextAttemptAt };
}

export type BrainVectorSyncFailureResult =
  | Readonly<{ outcome: "retry-scheduled"; attemptCount: number; nextAttemptAt: Date }>
  | Readonly<{ outcome: "failed"; attemptCount: number }>;

export type FailedBrainVectorSyncJob = Readonly<{
  jobId: string;
  brainItemId: string;
  itemRevision: number;
  operation: "upsert" | "delete";
  attemptCount: number;
  failureCode: string;
  failedAt: Date;
}>;

export type FailedBrainVectorSyncJobList = Readonly<{
  jobs: readonly FailedBrainVectorSyncJob[];
  truncated: boolean;
}>;

/** 本文を含めず、運用者が再試行対象を特定するための終端jobだけを返す。 */
export async function listFailedBrainVectorSyncJobs(
  db: AccountDataDatabase,
): Promise<FailedBrainVectorSyncJobList> {
  const rows = await db
    .select({
      jobId: brainVectorSyncJobs.id,
      brainItemId: brainVectorSyncJobs.brainItemId,
      itemRevision: brainVectorSyncJobs.itemRevision,
      operation: brainVectorSyncJobs.operation,
      attemptCount: brainVectorSyncJobs.attemptCount,
      failureCode: brainVectorSyncJobs.failureCode,
      failedAt: brainVectorSyncJobs.updatedAt,
    })
    .from(brainVectorSyncJobs)
    .where(and(eq(brainVectorSyncJobs.status, "failed"), eq(brainVectorSyncJobs.isDeleted, false)))
    .orderBy(desc(brainVectorSyncJobs.updatedAt), asc(brainVectorSyncJobs.id))
    .limit(DEVELOPMENT_FAILED_VECTOR_SYNC_JOB_LIMIT + 1)
    .all();
  return {
    jobs: rows.slice(0, DEVELOPMENT_FAILED_VECTOR_SYNC_JOB_LIMIT).map((job) => ({
      ...job,
      failureCode: job.failureCode ?? "BRAIN_VECTOR_SYNC_FAILED",
    })),
    truncated: rows.length > DEVELOPMENT_FAILED_VECTOR_SYNC_JOB_LIMIT,
  };
}

/** 運用者が原因を解消した後、恒久失敗jobを明示的に最初から再試行する。 */
export async function resetFailedBrainVectorSyncJob(
  db: AccountDataDatabase,
  jobId: string,
  at = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(brainVectorSyncJobs)
    .set({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: at,
      failureCode: null,
      updatedAt: at,
    })
    .where(
      and(
        eq(brainVectorSyncJobs.id, jobId),
        eq(brainVectorSyncJobs.status, "failed"),
        eq(brainVectorSyncJobs.isDeleted, false),
      ),
    )
    .returning({ id: brainVectorSyncJobs.id })
    .all();
  return rows.length > 0;
}

/** Account内の恒久失敗jobをまとめて最初から再試行できる状態へ戻す。 */
export async function resetAllFailedBrainVectorSyncJobs(
  db: AccountDataDatabase,
  at = new Date(),
): Promise<number> {
  const rows = await db
    .update(brainVectorSyncJobs)
    .set({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: at,
      failureCode: null,
      updatedAt: at,
    })
    .where(and(eq(brainVectorSyncJobs.status, "failed"), eq(brainVectorSyncJobs.isDeleted, false)))
    .returning({ id: brainVectorSyncJobs.id })
    .all();
  return rows.length;
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

export type ActiveBrainVectorEntry = Readonly<{
  vectorId: string;
  itemRevision: number;
}>;

/** 開発用の実体確認に必要なvector IDをactive Itemに限って返す。 */
export async function findActiveBrainVectorEntry(
  db: AccountDataDatabase,
  accountId: string,
  brainItemId: string,
): Promise<ActiveBrainVectorEntry | undefined> {
  return db
    .select({ vectorId: brainVectorEntries.id, itemRevision: brainVectorEntries.itemRevision })
    .from(brainVectorEntries)
    .innerJoin(brainItems, eq(brainItems.id, brainVectorEntries.brainItemId))
    .where(
      and(
        eq(brainVectorEntries.brainItemId, brainItemId),
        eq(brainVectorEntries.isDeleted, false),
        eq(brainItems.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
      ),
    )
    .get();
}

/**
 * Vectorize候補をAccountDataで再認可し、同期前の直近Itemも補って意味的重複判定へ返す。
 * statement以外のEvidence本文やAccess Labelは重複判定モデルへ渡さない。
 */
export async function loadBrainSemanticDedupCandidates(
  db: AccountDataDatabase,
  accountId: string,
  vectorIds: readonly string[],
  categories: readonly string[],
): Promise<readonly BrainSemanticDedupCandidate[]> {
  const candidateVectorIds = [...new Set(vectorIds.filter(Boolean))].slice(
    0,
    SEMANTIC_DEDUP_VECTOR_CANDIDATE_LIMIT,
  );
  const candidateCategories = [...new Set(categories.filter(Boolean))].slice(0, 6);
  if (candidateCategories.length === 0) return [];

  const vectorRows =
    candidateVectorIds.length === 0
      ? []
      : await db
          .select({
            vectorId: brainVectorEntries.id,
            brainItemId: brainItems.id,
            category: brainItems.category,
            statement: brainItems.statement,
            attributes: brainItems.attributes,
            derivation: brainItems.derivation,
          })
          .from(brainVectorEntries)
          .innerJoin(brainItems, eq(brainItems.id, brainVectorEntries.brainItemId))
          .where(
            and(
              inArray(brainVectorEntries.id, candidateVectorIds),
              eq(brainVectorEntries.isDeleted, false),
              eq(brainItems.accountId, accountId),
              inArray(brainItems.category, candidateCategories),
              eq(brainItems.status, "active"),
              eq(brainItems.isDeleted, false),
            ),
          )
          .all();
  const recentRows = await db
    .select({
      brainItemId: brainItems.id,
      category: brainItems.category,
      statement: brainItems.statement,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
    })
    .from(brainItems)
    .where(
      and(
        eq(brainItems.accountId, accountId),
        inArray(brainItems.category, candidateCategories),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
      ),
    )
    .orderBy(desc(brainItems.createdAt), desc(brainItems.id))
    .limit(SEMANTIC_DEDUP_RECENT_CANDIDATE_LIMIT)
    .all();

  const vectorRowById = new Map(vectorRows.map((row) => [row.vectorId, row] as const));
  const orderedVectorRows = candidateVectorIds.flatMap((vectorId) => {
    const row = vectorRowById.get(vectorId);
    return row ? [row] : [];
  });
  const vectorRowsBeforeRecent = Math.max(
    0,
    SEMANTIC_DEDUP_CANDIDATE_LIMIT - SEMANTIC_DEDUP_RECENT_RESERVED_LIMIT,
  );
  const ordered = [
    ...orderedVectorRows.slice(0, vectorRowsBeforeRecent),
    ...recentRows.slice(0, SEMANTIC_DEDUP_RECENT_RESERVED_LIMIT),
    ...orderedVectorRows.slice(vectorRowsBeforeRecent),
    ...recentRows.slice(SEMANTIC_DEDUP_RECENT_RESERVED_LIMIT),
  ];
  const seen = new Set<string>();
  return ordered
    .flatMap((item) => {
      if (seen.has(item.brainItemId)) return [];
      const comparisonText = buildDiaryTemporalSearchText(
        item.statement,
        readDiaryTemporalContext(item.attributes),
      );
      if (comparisonText.length > SEMANTIC_DEDUP_COMPARISON_TEXT_LIMIT) return [];
      seen.add(item.brainItemId);
      return [
        {
          brainItemId: item.brainItemId,
          category: item.category,
          statement: item.statement,
          comparisonText,
          isInference: brainItemIsInference(item.attributes, item.derivation),
        },
      ];
    })
    .slice(0, SEMANTIC_DEDUP_CANDIDATE_LIMIT);
}

/**
 * Vectorizeが返した仮名IDを候補としてのみ扱い、AccountDataの現在状態で通常チャット用に再認可する。
 * 入力順（類似度順）を保ち、原文EvidenceはContext全体で最大3件に制限する。
 */
export async function loadBrainChatContextMemories(
  db: AccountDataDatabase,
  accountId: string,
  vectorIds: readonly string[],
  at = new Date(),
): Promise<readonly BrainChatContextMemory[]> {
  const candidateVectorIds = [...new Set(vectorIds.filter((id) => id.length > 0))].slice(
    0,
    CHAT_CONTEXT_VECTOR_CANDIDATE_LIMIT,
  );
  if (candidateVectorIds.length === 0) return [];

  const rows = await db
    .select({
      vectorId: brainVectorEntries.id,
      brainItemId: brainItems.id,
      category: brainItems.category,
      statement: brainItems.statement,
      attributes: brainItems.attributes,
      derivation: brainItems.derivation,
      confidence: brainItems.confidence,
      createdAt: brainItems.createdAt,
      accessLabel: brainItemAccessLabels.label,
    })
    .from(brainVectorEntries)
    .innerJoin(brainItems, eq(brainItems.id, brainVectorEntries.brainItemId))
    .innerJoin(
      brainItemAccessLabels,
      and(
        eq(brainItemAccessLabels.brainItemId, brainItems.id),
        eq(brainItemAccessLabels.isDeleted, false),
      ),
    )
    .where(
      and(
        inArray(brainVectorEntries.id, candidateVectorIds),
        eq(brainVectorEntries.isDeleted, false),
        eq(brainItems.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        or(isNull(brainItems.validFrom), lte(brainItems.validFrom, at)),
        or(isNull(brainItems.validTo), gt(brainItems.validTo, at)),
      ),
    )
    .all();
  const rowByVectorId = new Map(rows.map((row) => [row.vectorId, row] as const));
  const authorized = candidateVectorIds
    .flatMap((vectorId) => {
      const row = rowByVectorId.get(vectorId);
      return row ? [row] : [];
    })
    .slice(0, CHAT_CONTEXT_MEMORY_LIMIT);
  const authorizedItemIds = authorized.map(({ brainItemId }) => brainItemId);
  const observationRows =
    authorizedItemIds.length === 0
      ? []
      : await db
          .select({
            brainItemId: brainItemEvidenceEdges.brainItemId,
            firstObservedAt: min(sourceRecords.createdAt),
            lastObservedAt: max(sourceRecords.createdAt),
          })
          .from(brainItemEvidenceEdges)
          .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
          .where(
            and(
              inArray(brainItemEvidenceEdges.brainItemId, authorizedItemIds),
              eq(brainItemEvidenceEdges.relation, "supports"),
              eq(brainItemEvidenceEdges.isDeleted, false),
              eq(sourceRecords.accountId, accountId),
              eq(sourceRecords.isDeleted, false),
            ),
          )
          .groupBy(brainItemEvidenceEdges.brainItemId)
          .all();
  const observationsByItemId = new Map(
    observationRows.map((row) => [row.brainItemId, row] as const),
  );

  let remainingEvidence = CHAT_CONTEXT_EVIDENCE_LIMIT;
  const memories: BrainChatContextMemory[] = [];
  for (const item of authorized) {
    const observations = observationsByItemId.get(item.brainItemId);
    const accessLabels = rows
      .filter((row) => row.vectorId === item.vectorId)
      .map((row) => row.accessLabel);
    const evidence =
      remainingEvidence === 0
        ? []
        : await db
            .select({
              sourceRecordId: sourceRecords.id,
              text: sourceRecordTextPayloads.body,
              recordedAt: sourceRecords.createdAt,
            })
            .from(brainItemEvidenceEdges)
            .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
            .innerJoin(
              sourceRecordTextPayloads,
              eq(sourceRecordTextPayloads.sourceRecordId, sourceRecords.id),
            )
            .where(
              and(
                eq(brainItemEvidenceEdges.brainItemId, item.brainItemId),
                eq(brainItemEvidenceEdges.relation, "supports"),
                eq(brainItemEvidenceEdges.isDeleted, false),
                eq(sourceRecords.accountId, accountId),
                eq(sourceRecords.isDeleted, false),
              ),
            )
            .orderBy(desc(brainItemEvidenceEdges.generatedAt), desc(brainItemEvidenceEdges.id))
            .limit(remainingEvidence)
            .all();
    remainingEvidence -= evidence.length;
    memories.push({
      brainItemId: item.brainItemId,
      category: item.category,
      statement: item.statement,
      derivation: item.derivation,
      isInference: brainItemIsInference(item.attributes, item.derivation),
      status: "active",
      confidence: item.confidence,
      accessLabels: [...new Set(accessLabels)].sort(),
      firstObservedAt: observations?.firstObservedAt ?? item.createdAt,
      lastObservedAt: observations?.lastObservedAt ?? item.createdAt,
      evidence,
    });
  }
  return memories;
}

/** 開発用の確認画面へ、本人のactiveなBrain Item、根拠、Vector同期状態を返す。 */
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
      firstObservedAt: min(sourceRecords.createdAt),
      lastObservedAt: max(sourceRecords.createdAt),
    })
    .from(brainItems)
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
    .where(
      and(
        eq(brainItems.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
      ),
    )
    .groupBy(
      brainItems.id,
      brainItems.category,
      brainItems.statement,
      brainItems.derivation,
      brainItems.status,
      brainItems.createdAt,
    )
    .orderBy(desc(max(sourceRecords.createdAt)), desc(brainItems.id))
    .limit(DEVELOPMENT_BRAIN_ITEM_LIMIT + 1);
  const truncated = rows.length > DEVELOPMENT_BRAIN_ITEM_LIMIT;
  const items = rows.slice(0, DEVELOPMENT_BRAIN_ITEM_LIMIT);
  const itemIds = items.map(({ id }) => id);
  const [evidenceRows, vectorJobs, vectorEntries] = await Promise.all([
    itemIds.length === 0
      ? []
      : db
          .select({
            brainItemId: brainItemEvidenceEdges.brainItemId,
            sourceRecordId: brainItemEvidenceEdges.sourceRecordId,
            relation: brainItemEvidenceEdges.relation,
            derivationMethod: brainItemEvidenceEdges.derivationMethod,
            generatedAt: brainItemEvidenceEdges.generatedAt,
            recordedAt: sourceRecords.createdAt,
          })
          .from(brainItemEvidenceEdges)
          .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
          .where(
            and(
              inArray(brainItemEvidenceEdges.brainItemId, itemIds),
              eq(brainItemEvidenceEdges.isDeleted, false),
              eq(sourceRecords.accountId, accountId),
              eq(sourceRecords.isDeleted, false),
            ),
          )
          .orderBy(sourceRecords.createdAt, brainItemEvidenceEdges.id),
    itemIds.length === 0
      ? []
      : db
          .select({
            brainItemId: brainVectorSyncJobs.brainItemId,
            status: brainVectorSyncJobs.status,
            operation: brainVectorSyncJobs.operation,
            attemptCount: brainVectorSyncJobs.attemptCount,
            updatedAt: brainVectorSyncJobs.updatedAt,
            nextAttemptAt: brainVectorSyncJobs.nextAttemptAt,
            failureCode: brainVectorSyncJobs.failureCode,
          })
          .from(brainVectorSyncJobs)
          .where(
            and(
              inArray(brainVectorSyncJobs.brainItemId, itemIds),
              eq(brainVectorSyncJobs.isDeleted, false),
            ),
          )
          .orderBy(
            desc(brainVectorSyncJobs.itemRevision),
            desc(brainVectorSyncJobs.updatedAt),
            desc(brainVectorSyncJobs.id),
          ),
    itemIds.length === 0
      ? []
      : db
          .select({
            brainItemId: brainVectorEntries.brainItemId,
            itemRevision: brainVectorEntries.itemRevision,
          })
          .from(brainVectorEntries)
          .where(
            and(
              inArray(brainVectorEntries.brainItemId, itemIds),
              eq(brainVectorEntries.isDeleted, false),
            ),
          ),
  ]);

  const latestVectorJobByItem = new Map<string, (typeof vectorJobs)[number]>();
  for (const job of vectorJobs) {
    if (!latestVectorJobByItem.has(job.brainItemId)) {
      latestVectorJobByItem.set(job.brainItemId, job);
    }
  }
  const vectorEntryByItem = new Map(
    vectorEntries.map((entry) => [entry.brainItemId, entry] as const),
  );

  return {
    items: items.map((item) => {
      const job = latestVectorJobByItem.get(item.id);
      const entry = vectorEntryByItem.get(item.id);
      return {
        ...item,
        firstObservedAt: item.firstObservedAt ?? item.createdAt,
        lastObservedAt: item.lastObservedAt ?? item.createdAt,
        status: "active" as const,
        vectorSync: {
          status: job?.status ?? ("not-scheduled" as const),
          ...(job ? { operation: job.operation, updatedAt: job.updatedAt } : {}),
          attemptCount: job?.attemptCount ?? 0,
          ...(job && ["pending", "submitted", "retry_scheduled"].includes(job.status)
            ? { nextAttemptAt: job.nextAttemptAt }
            : {}),
          ...(job?.failureCode ? { failureCode: job.failureCode } : {}),
          hasEntry: Boolean(entry),
          ...(entry ? { entryRevision: entry.itemRevision } : {}),
        },
        evidence: evidenceRows
          .filter(({ brainItemId }) => brainItemId === item.id)
          .map(({ brainItemId: _, ...evidence }) => evidence),
      };
    }),
    truncated,
  };
}
