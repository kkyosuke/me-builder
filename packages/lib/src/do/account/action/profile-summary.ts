import { and, countDistinct, desc, eq, inArray, max, notInArray } from "drizzle-orm";
import type {
  CompleteProfileSummaryGenerationInput,
  ProfileSummaryGenerationContext,
  ProfileSummaryInputSnapshot,
  ProfileSummaryReadModel,
  ProfileSummaryRegenerationReason,
  RequestProfileSummaryGenerationResult,
} from "../../../profile-summary";
import type { AccountDataDatabase } from "../database";
import { brainItems } from "../schema/brain";
import { diagnosisBrainProjectionHeads } from "../schema/diagnosis";
import {
  conversationMessages,
  conversationSessions,
  sourceRecordTextPayloads,
} from "../schema/diary";
import { profileSummaryGenerations, profileSummaryVersions } from "../schema/profile-summary";
import { sourceRecords } from "../schema/source";

const PROFILE_SUMMARY_EVIDENCE_LIMIT = 100;
export const PROFILE_SUMMARY_REGENERATION_INTERVAL_MS = 30 * 24 * 60 * 60 * 1_000;

async function availableData(db: AccountDataDatabase, accountId: string) {
  const diagnosis = await db
    .select({ value: countDistinct(diagnosisBrainProjectionHeads.diagnosisId) })
    .from(diagnosisBrainProjectionHeads)
    .where(eq(diagnosisBrainProjectionHeads.accountId, accountId))
    .get();
  const diary = await db
    .select({ value: countDistinct(conversationMessages.sourceRecordId) })
    .from(conversationMessages)
    .innerJoin(conversationSessions, eq(conversationMessages.sessionId, conversationSessions.id))
    .where(
      and(
        eq(conversationSessions.accountId, accountId),
        eq(conversationMessages.role, "user"),
        eq(conversationMessages.isDeleted, false),
      ),
    )
    .get();
  return { diagnosis: Number(diagnosis?.value ?? 0), diary: Number(diary?.value ?? 0) };
}

function latestDate(...dates: readonly (Date | null | undefined)[]): Date | null {
  return dates.reduce<Date | null>(
    (latest, date) => (!date || (latest && latest >= date) ? latest : date),
    null,
  );
}

async function currentInputSnapshot(
  db: AccountDataDatabase,
  accountId: string,
): Promise<ProfileSummaryInputSnapshot> {
  const diagnosisItemIds = (
    await db
      .select({ id: diagnosisBrainProjectionHeads.currentBrainItemId })
      .from(diagnosisBrainProjectionHeads)
      .where(eq(diagnosisBrainProjectionHeads.accountId, accountId))
      .all()
  ).map(({ id }) => id);
  const [diagnosis, diaryMessages, diaryBrain] = await Promise.all([
    db
      .select({
        count: countDistinct(diagnosisBrainProjectionHeads.diagnosisId),
        latest: max(brainItems.createdAt),
      })
      .from(diagnosisBrainProjectionHeads)
      .innerJoin(brainItems, eq(diagnosisBrainProjectionHeads.currentBrainItemId, brainItems.id))
      .where(
        and(
          eq(diagnosisBrainProjectionHeads.accountId, accountId),
          eq(brainItems.status, "active"),
          eq(brainItems.isDeleted, false),
        ),
      )
      .get(),
    db
      .select({
        count: countDistinct(conversationMessages.sourceRecordId),
        latest: max(sourceRecords.createdAt),
      })
      .from(conversationMessages)
      .innerJoin(conversationSessions, eq(conversationMessages.sessionId, conversationSessions.id))
      .innerJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
      .where(
        and(
          eq(conversationSessions.accountId, accountId),
          eq(conversationMessages.role, "user"),
          eq(conversationMessages.isDeleted, false),
          eq(sourceRecords.isDeleted, false),
        ),
      )
      .get(),
    db
      .select({ count: countDistinct(brainItems.id), latest: max(brainItems.createdAt) })
      .from(brainItems)
      .where(
        and(
          eq(brainItems.accountId, accountId),
          eq(brainItems.status, "active"),
          eq(brainItems.isDeleted, false),
          ...(diagnosisItemIds.length > 0 ? [notInArray(brainItems.id, diagnosisItemIds)] : []),
        ),
      )
      .get(),
  ]);
  return {
    diagnosis: {
      count: Number(diagnosis?.count ?? 0),
      latestRecordedAt: diagnosis?.latest ?? null,
    },
    diary: {
      count: Number(diaryMessages?.count ?? 0) + Number(diaryBrain?.count ?? 0),
      latestRecordedAt: latestDate(diaryMessages?.latest, diaryBrain?.latest),
    },
  };
}

function regenerationReasons(
  current: ProfileSummaryInputSnapshot,
  latestVersion:
    | Pick<
        typeof profileSummaryVersions.$inferSelect,
        | "generatedAt"
        | "diagnosisInputCount"
        | "diagnosisInputLatestAt"
        | "diaryInputCount"
        | "diaryInputLatestAt"
      >
    | undefined,
  at: Date,
): ProfileSummaryRegenerationReason[] {
  if (!latestVersion) {
    return [
      ...(current.diagnosis.count > 0 ? (["diagnosis"] as const) : []),
      ...(current.diary.count > 0 ? (["brain"] as const) : []),
    ];
  }
  const diagnosisChanged =
    current.diagnosis.count > latestVersion.diagnosisInputCount ||
    (current.diagnosis.latestRecordedAt !== null &&
      (latestVersion.diagnosisInputLatestAt === null ||
        current.diagnosis.latestRecordedAt > latestVersion.diagnosisInputLatestAt));
  const diaryChanged =
    current.diary.count > latestVersion.diaryInputCount ||
    (current.diary.latestRecordedAt !== null &&
      (latestVersion.diaryInputLatestAt === null ||
        current.diary.latestRecordedAt > latestVersion.diaryInputLatestAt));
  return [
    ...(diagnosisChanged ? (["diagnosis"] as const) : []),
    ...(diaryChanged ? (["brain"] as const) : []),
    ...(at.getTime() - latestVersion.generatedAt.getTime() >=
    PROFILE_SUMMARY_REGENERATION_INTERVAL_MS
      ? (["elapsed"] as const)
      : []),
  ];
}

export async function readProfileSummary(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<ProfileSummaryReadModel> {
  const [counts, inputSnapshot, versionRows, latestGeneration] = await Promise.all([
    availableData(db, accountId),
    currentInputSnapshot(db, accountId),
    db.select().from(profileSummaryVersions).orderBy(desc(profileSummaryVersions.sequence)).all(),
    db
      .select()
      .from(profileSummaryGenerations)
      .where(eq(profileSummaryGenerations.accountId, accountId))
      .orderBy(desc(profileSummaryGenerations.requestedAt), desc(profileSummaryGenerations.id))
      .limit(1)
      .get(),
  ]);
  const active = latestGeneration?.status === "queued" || latestGeneration?.status === "generating";
  const status =
    latestGeneration?.status === "queued" ||
    latestGeneration?.status === "generating" ||
    latestGeneration?.status === "failed"
      ? latestGeneration.status
      : "idle";
  const reasons = regenerationReasons(inputSnapshot, versionRows[0], at);
  const hasInput = inputSnapshot.diagnosis.count + inputSnapshot.diary.count > 0;
  return {
    versions: versionRows.map((version, index) => ({
      id: version.id,
      sequence: version.sequence,
      generatedAt: version.generatedAt.toISOString(),
      isLatest: index === 0,
      generationMethod: "ai" as const,
      summary: version.summary,
    })),
    availableDataCounts: counts,
    generation: {
      status,
      canRegenerate: hasInput && reasons.length > 0 && !active,
      reasons,
      message: latestGeneration?.status === "failed" ? latestGeneration.failureMessage : null,
    },
  };
}

export async function requestProfileSummaryGeneration(
  db: AccountDataDatabase,
  accountId: string,
  requestedAt = new Date(),
): Promise<RequestProfileSummaryGenerationResult> {
  const existing = await db
    .select({ id: profileSummaryGenerations.id, status: profileSummaryGenerations.status })
    .from(profileSummaryGenerations)
    .where(
      and(
        eq(profileSummaryGenerations.accountId, accountId),
        inArray(profileSummaryGenerations.status, ["queued", "generating"]),
      ),
    )
    .limit(1)
    .get();
  if (existing && (existing.status === "queued" || existing.status === "generating")) {
    return { outcome: "existing", generationId: existing.id, status: existing.status };
  }
  const [inputSnapshot, latestVersion] = await Promise.all([
    currentInputSnapshot(db, accountId),
    db
      .select()
      .from(profileSummaryVersions)
      .orderBy(desc(profileSummaryVersions.sequence))
      .limit(1)
      .get(),
  ]);
  if (inputSnapshot.diagnosis.count + inputSnapshot.diary.count === 0) {
    return { outcome: "unavailable", reason: "source_record_required" };
  }
  if (regenerationReasons(inputSnapshot, latestVersion, requestedAt).length === 0) {
    return { outcome: "unavailable", reason: "regeneration_not_required" };
  }

  const generationId = crypto.randomUUID();
  await db
    .insert(profileSummaryGenerations)
    .values({ id: generationId, accountId, status: "queued", requestedAt })
    .run();
  return { outcome: "created", generationId, status: "queued" };
}

export async function loadProfileSummaryGenerationContext(
  db: AccountDataDatabase,
  accountId: string,
  generationId: string,
  startedAt = new Date(),
): Promise<ProfileSummaryGenerationContext | null> {
  const generation = await db
    .select()
    .from(profileSummaryGenerations)
    .where(
      and(
        eq(profileSummaryGenerations.id, generationId),
        eq(profileSummaryGenerations.accountId, accountId),
      ),
    )
    .get();
  if (!generation || generation.status === "completed" || generation.status === "failed") {
    return null;
  }
  if (generation.status === "queued") {
    await db
      .update(profileSummaryGenerations)
      .set({ status: "generating", startedAt })
      .where(eq(profileSummaryGenerations.id, generationId))
      .run();
  }

  const diagnosisRows = await db
    .select({
      id: brainItems.id,
      text: brainItems.statement,
      recordedAt: brainItems.createdAt,
    })
    .from(diagnosisBrainProjectionHeads)
    .innerJoin(brainItems, eq(diagnosisBrainProjectionHeads.currentBrainItemId, brainItems.id))
    .where(
      and(
        eq(diagnosisBrainProjectionHeads.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
      ),
    )
    .orderBy(desc(brainItems.createdAt))
    .limit(PROFILE_SUMMARY_EVIDENCE_LIMIT)
    .all();
  const diagnosisItemIds = (
    await db
      .select({ id: diagnosisBrainProjectionHeads.currentBrainItemId })
      .from(diagnosisBrainProjectionHeads)
      .where(eq(diagnosisBrainProjectionHeads.accountId, accountId))
      .all()
  ).map(({ id }) => id);
  const otherBrainRows = await db
    .select({ id: brainItems.id, text: brainItems.statement, recordedAt: brainItems.createdAt })
    .from(brainItems)
    .where(
      and(
        eq(brainItems.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
        ...(diagnosisItemIds.length > 0 ? [notInArray(brainItems.id, diagnosisItemIds)] : []),
      ),
    )
    .orderBy(desc(brainItems.createdAt))
    .limit(PROFILE_SUMMARY_EVIDENCE_LIMIT)
    .all();
  const diaryRows = await db
    .select({
      sourceRecordId: sourceRecords.id,
      text: sourceRecordTextPayloads.body,
      recordedAt: sourceRecords.createdAt,
    })
    .from(conversationMessages)
    .innerJoin(conversationSessions, eq(conversationMessages.sessionId, conversationSessions.id))
    .innerJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
    .innerJoin(
      sourceRecordTextPayloads,
      eq(sourceRecords.id, sourceRecordTextPayloads.sourceRecordId),
    )
    .where(
      and(
        eq(conversationSessions.accountId, accountId),
        eq(conversationMessages.role, "user"),
        eq(conversationMessages.isDeleted, false),
        eq(sourceRecords.isDeleted, false),
      ),
    )
    .orderBy(desc(sourceRecords.createdAt))
    .limit(PROFILE_SUMMARY_EVIDENCE_LIMIT)
    .all();
  const counts = await availableData(db, accountId);
  const evidence = [
    ...diagnosisRows.map((row) => ({
      id: `brain:${row.id}`,
      source: "diagnosis" as const,
      text: row.text,
      recordedAt: row.recordedAt,
    })),
    ...otherBrainRows.map((row) => ({
      id: `brain:${row.id}`,
      source: "diary" as const,
      text: row.text,
      recordedAt: row.recordedAt,
    })),
    ...diaryRows.map((row) => ({
      id: `diary:${row.sourceRecordId}`,
      source: "diary" as const,
      text: row.text,
      recordedAt: row.recordedAt,
    })),
  ];
  const latestRecordedAt = evidence.reduce<Date | null>(
    (latest, item) => (!latest || item.recordedAt > latest ? item.recordedAt : latest),
    null,
  );
  const inputSnapshot = await currentInputSnapshot(db, accountId);
  return {
    generationId,
    evidence,
    diagnosisCount: counts.diagnosis,
    diaryCount: counts.diary,
    latestRecordedAt,
    inputSnapshot,
  };
}

export async function completeProfileSummaryGeneration(
  db: AccountDataDatabase,
  accountId: string,
  input: CompleteProfileSummaryGenerationInput,
): Promise<boolean> {
  const generation = await db
    .select({ status: profileSummaryGenerations.status })
    .from(profileSummaryGenerations)
    .where(
      and(
        eq(profileSummaryGenerations.id, input.generationId),
        eq(profileSummaryGenerations.accountId, accountId),
      ),
    )
    .get();
  if (!generation) return false;
  if (generation.status === "completed") return true;
  if (generation.status === "failed") return false;
  const previous = await db
    .select({ sequence: profileSummaryVersions.sequence })
    .from(profileSummaryVersions)
    .orderBy(desc(profileSummaryVersions.sequence))
    .limit(1)
    .get();
  const sequence = (previous?.sequence ?? 0) + 1;
  const summary = {
    generatedAt: input.generatedAt.toISOString(),
    headline: input.headline,
    insights: input.insights,
    recordCount: input.diagnosisCount + input.diaryCount,
    diagnosisCount: input.diagnosisCount,
    diaryCount: input.diaryCount,
    latestRecordedAt: input.latestRecordedAt?.toISOString() ?? null,
  };
  await db.batch([
    db
      .insert(profileSummaryVersions)
      .values({
        id: crypto.randomUUID(),
        generationId: input.generationId,
        sequence,
        generatedAt: input.generatedAt,
        model: input.model,
        promptVersion: input.promptVersion,
        diagnosisInputCount: input.inputSnapshot.diagnosis.count,
        diagnosisInputLatestAt: input.inputSnapshot.diagnosis.latestRecordedAt,
        diaryInputCount: input.inputSnapshot.diary.count,
        diaryInputLatestAt: input.inputSnapshot.diary.latestRecordedAt,
        summary,
      })
      .onConflictDoNothing(),
    db
      .update(profileSummaryGenerations)
      .set({
        status: "completed",
        finishedAt: input.generatedAt,
        failureMessage: null,
        model: input.model,
        promptVersion: input.promptVersion,
      })
      .where(eq(profileSummaryGenerations.id, input.generationId)),
  ]);
  return true;
}

export async function failProfileSummaryGeneration(
  db: AccountDataDatabase,
  accountId: string,
  generationId: string,
  message: string,
  failedAt = new Date(),
): Promise<void> {
  await db
    .update(profileSummaryGenerations)
    .set({ status: "failed", failureMessage: message, finishedAt: failedAt })
    .where(
      and(
        eq(profileSummaryGenerations.id, generationId),
        eq(profileSummaryGenerations.accountId, accountId),
        inArray(profileSummaryGenerations.status, ["queued", "generating"]),
      ),
    )
    .run();
}
