import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  max,
  notInArray,
  sql,
} from "drizzle-orm";
import type {
  CompatibilityShareProfileReadResult,
  CompleteProfileSummaryGenerationInput,
  ProfileSummaryGenerationContext,
  ProfileSummaryInputSnapshot,
  ProfileSummaryReadModel,
  ProfileSummaryRegenerationReason,
  RequestProfileSummaryGenerationResult,
} from "../../../profile-summary";
import {
  PROFILE_SUMMARY_DISPATCH_BATCH_SIZE,
  PROFILE_SUMMARY_DISPATCH_RECOVERY_MS,
  createCompatibilityShareProfileFingerprint,
} from "../../../profile-summary";
import type { AccountDataDatabase } from "../database";
import { brainItems } from "../schema/brain";
import { diagnosisBrainProjectionHeads } from "../schema/diagnosis";
import {
  conversationMessages,
  conversationSessions,
  sourceRecordTextPayloads,
} from "../schema/diary";
import {
  profileSummaryGenerations,
  profileSummaryShareProjections,
  profileSummaryVersions,
} from "../schema/profile-summary";
import { sourceRecords } from "../schema/source";

const PROFILE_SUMMARY_EVIDENCE_LIMIT = 100;
export const PROFILE_SUMMARY_REGENERATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

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
  hasCurrentGenerationOutput: boolean,
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
    ...(!hasCurrentGenerationOutput ? (["format"] as const) : []),
  ];
}

function canRegenerateProfileSummary(
  latestVersion: Pick<typeof profileSummaryVersions.$inferSelect, "generatedAt"> | undefined,
  reasons: readonly ProfileSummaryRegenerationReason[],
  at: Date,
): boolean {
  if (!latestVersion) return reasons.length > 0;
  return (
    reasons.length > 0 &&
    at.getTime() - latestVersion.generatedAt.getTime() >= PROFILE_SUMMARY_REGENERATION_INTERVAL_MS
  );
}

export async function readProfileSummary(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
  allowUnchangedRegeneration = false,
): Promise<ProfileSummaryReadModel> {
  const [counts, inputSnapshot, versionRows, latestGeneration, shareProfile] = await Promise.all([
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
    readCompatibilityShareProfile(db, accountId),
  ]);
  const active = latestGeneration?.status === "queued" || latestGeneration?.status === "generating";
  const status =
    latestGeneration?.status === "queued" ||
    latestGeneration?.status === "generating" ||
    latestGeneration?.status === "failed"
      ? latestGeneration.status
      : "idle";
  const reasons = regenerationReasons(
    inputSnapshot,
    versionRows[0],
    shareProfile.type === "available" &&
      shareProfile.profile.profileSummaryVersionId === versionRows[0]?.id,
  );
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
      canRegenerate:
        hasInput &&
        (allowUnchangedRegeneration || canRegenerateProfileSummary(versionRows[0], reasons, at)) &&
        !active,
      reasons,
      message: latestGeneration?.status === "failed" ? latestGeneration.failureMessage : null,
    },
  };
}

/** 最新の共有専用projectionを返す。内部根拠が無効なら文章を開示しない。 */
export async function readCompatibilityShareProfile(
  db: AccountDataDatabase,
  accountId: string,
): Promise<CompatibilityShareProfileReadResult> {
  const projection = await db
    .select({
      profileSummaryVersionId: profileSummaryShareProjections.profileSummaryVersionId,
      generatedAt: profileSummaryShareProjections.generatedAt,
      statements: profileSummaryShareProjections.statements,
      evidenceReferences: profileSummaryShareProjections.evidenceReferences,
      fingerprint: profileSummaryShareProjections.fingerprint,
    })
    .from(profileSummaryShareProjections)
    .innerJoin(
      profileSummaryVersions,
      eq(profileSummaryShareProjections.profileSummaryVersionId, profileSummaryVersions.id),
    )
    // 共有できる文章が残らなかった版のprojectionは共有対象にせず、
    // 旧実装が保存した空のprojectionも同じ扱いで読み飛ばす。
    .where(sql`json_array_length(${profileSummaryShareProjections.statements}) > 0`)
    .orderBy(desc(profileSummaryVersions.sequence))
    .limit(1)
    .get();
  if (!projection) return { type: "unavailable" };
  if (projection.evidenceReferences.length === 0) return { type: "stale" };

  const evidenceReferences = [...new Set(projection.evidenceReferences)];
  const brainIds: string[] = [];
  const diaryIds: string[] = [];
  for (const reference of evidenceReferences) {
    if (reference.startsWith("brain:")) brainIds.push(reference.slice("brain:".length));
    else if (reference.startsWith("diary:")) diaryIds.push(reference.slice("diary:".length));
    else return { type: "stale" };
  }
  if (brainIds.some((id) => id.length === 0) || diaryIds.some((id) => id.length === 0)) {
    return { type: "stale" };
  }

  const [activeBrainRows, activeDiaryRows] = await Promise.all([
    brainIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: brainItems.id })
          .from(brainItems)
          .where(
            and(
              eq(brainItems.accountId, accountId),
              eq(brainItems.status, "active"),
              eq(brainItems.isDeleted, false),
              inArray(brainItems.id, brainIds),
            ),
          )
          .all(),
    diaryIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: sourceRecords.id })
          .from(conversationMessages)
          .innerJoin(
            conversationSessions,
            eq(conversationMessages.sessionId, conversationSessions.id),
          )
          .innerJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
          .where(
            and(
              eq(conversationSessions.accountId, accountId),
              eq(conversationMessages.role, "user"),
              eq(conversationMessages.isDeleted, false),
              eq(sourceRecords.isDeleted, false),
              inArray(sourceRecords.id, diaryIds),
            ),
          )
          .all(),
  ]);
  const activeBrainIds = new Set(activeBrainRows.map(({ id }) => id));
  const activeDiaryIds = new Set(activeDiaryRows.map(({ id }) => id));
  if (
    brainIds.some((id) => !activeBrainIds.has(id)) ||
    diaryIds.some((id) => !activeDiaryIds.has(id))
  ) {
    return { type: "stale" };
  }

  return {
    type: "available",
    profile: {
      profileSummaryVersionId: projection.profileSummaryVersionId,
      generatedAt: projection.generatedAt.toISOString(),
      statements: projection.statements,
      fingerprint: projection.fingerprint,
    },
  };
}

export async function requestProfileSummaryGeneration(
  db: AccountDataDatabase,
  accountId: string,
  requestedAt = new Date(),
  allowUnchangedRegeneration = false,
): Promise<RequestProfileSummaryGenerationResult> {
  const existing = await db
    .select({
      id: profileSummaryGenerations.id,
      status: profileSummaryGenerations.status,
      dispatchedAt: profileSummaryGenerations.dispatchedAt,
    })
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
    return {
      outcome: "existing",
      generationId: existing.id,
      status: existing.status,
      needsDispatch: existing.status === "queued" && existing.dispatchedAt === null,
    };
  }
  const [inputSnapshot, latestVersion, shareProfile] = await Promise.all([
    currentInputSnapshot(db, accountId),
    db
      .select()
      .from(profileSummaryVersions)
      .orderBy(desc(profileSummaryVersions.sequence))
      .limit(1)
      .get(),
    readCompatibilityShareProfile(db, accountId),
  ]);
  if (inputSnapshot.diagnosis.count + inputSnapshot.diary.count === 0) {
    return { outcome: "unavailable", reason: "source_record_required" };
  }
  const reasons = regenerationReasons(
    inputSnapshot,
    latestVersion,
    shareProfile.type === "available" &&
      shareProfile.profile.profileSummaryVersionId === latestVersion?.id,
  );
  if (
    !allowUnchangedRegeneration &&
    !canRegenerateProfileSummary(latestVersion, reasons, requestedAt)
  ) {
    return { outcome: "unavailable", reason: "regeneration_not_required" };
  }

  const generationId = crypto.randomUUID();
  await db
    .insert(profileSummaryGenerations)
    .values({ id: generationId, accountId, status: "queued", requestedAt })
    .run();
  return { outcome: "created", generationId, status: "queued", needsDispatch: true };
}

/** Queueへ未投入の生成要求を、AccountData alarmから復旧できる単位で返す。 */
export async function listUndispatchedProfileSummaryGenerationIds(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
  limit = PROFILE_SUMMARY_DISPATCH_BATCH_SIZE,
): Promise<string[]> {
  const recoveryCutoff = new Date(at.getTime() - PROFILE_SUMMARY_DISPATCH_RECOVERY_MS);
  const rows = await db
    .select({ id: profileSummaryGenerations.id })
    .from(profileSummaryGenerations)
    .where(
      and(
        eq(profileSummaryGenerations.accountId, accountId),
        eq(profileSummaryGenerations.status, "queued"),
        isNull(profileSummaryGenerations.dispatchedAt),
        lte(profileSummaryGenerations.requestedAt, recoveryCutoff),
      ),
    )
    .orderBy(asc(profileSummaryGenerations.requestedAt), asc(profileSummaryGenerations.id))
    .limit(limit)
    .all();
  return rows.map(({ id }) => id);
}

/** Queueが受理した後だけ配送済みにする。重複配送時も同じgeneration IDを維持する。 */
export async function markProfileSummaryGenerationDispatched(
  db: AccountDataDatabase,
  accountId: string,
  generationId: string,
  dispatchedAt = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(profileSummaryGenerations)
    .set({ dispatchedAt })
    .where(
      and(
        eq(profileSummaryGenerations.id, generationId),
        eq(profileSummaryGenerations.accountId, accountId),
        eq(profileSummaryGenerations.status, "queued"),
        isNull(profileSummaryGenerations.dispatchedAt),
      ),
    )
    .returning({ id: profileSummaryGenerations.id })
    .get();
  return updated?.id === generationId;
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

  // AIへ渡す入力の境界を最初に固定する。これ以降に追加された入力は、この版で
  // 使用済みにせず、次回の再生成理由として検出できる状態を保つ。
  const inputSnapshot = await currentInputSnapshot(db, accountId);
  const diagnosisLatestAt = inputSnapshot.diagnosis.latestRecordedAt;
  const diaryLatestAt = inputSnapshot.diary.latestRecordedAt;
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
        ...(diagnosisLatestAt ? [lte(brainItems.createdAt, diagnosisLatestAt)] : []),
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
        ...(diaryLatestAt ? [lte(brainItems.createdAt, diaryLatestAt)] : []),
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
        ...(diaryLatestAt ? [lte(sourceRecords.createdAt, diaryLatestAt)] : []),
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
  return {
    generationId,
    evidence,
    diagnosisCount: counts.diagnosis,
    diaryCount: counts.diary,
    latestRecordedAt,
    inputSnapshot,
  };
}

/** Queue再送時に生成結果と利用量ledgerを同じ最終状態へ収束させるための最小状態読取。 */
export async function readProfileSummaryGenerationStatus(
  db: AccountDataDatabase,
  accountId: string,
  generationId: string,
): Promise<(typeof profileSummaryGenerations.$inferSelect)["status"] | null> {
  const generation = await db
    .select({ status: profileSummaryGenerations.status })
    .from(profileSummaryGenerations)
    .where(
      and(
        eq(profileSummaryGenerations.id, generationId),
        eq(profileSummaryGenerations.accountId, accountId),
      ),
    )
    .get();
  return generation?.status ?? null;
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
  const profileSummaryVersionId = crypto.randomUUID();
  const compatibilityShareStatements = input.compatibilityShareStatements.map(
    ({ key, label, statement }) => ({ key, label, statement }),
  );
  const compatibilityShareEvidenceReferences = [
    ...new Set(input.compatibilityShareStatements.flatMap(({ evidenceIds }) => evidenceIds)),
  ];
  // 共有できる文章が1件も残らなかった生成では新しいprojectionを作らない。
  // 相手ごとの継続同意では常に最新projectionを共有するため、空を保存すると
  // 成立済みの共有が本人の操作なしに止まる。前版のprojectionを最新のまま残す。
  const shareProjectionInserts =
    compatibilityShareStatements.length > 0
      ? [
          db.insert(profileSummaryShareProjections).values({
            profileSummaryVersionId,
            schemaVersion: 1,
            generatedAt: input.generatedAt,
            statements: compatibilityShareStatements,
            evidenceReferences: compatibilityShareEvidenceReferences,
            fingerprint: await createCompatibilityShareProfileFingerprint(
              profileSummaryVersionId,
              compatibilityShareStatements,
            ),
          }),
        ]
      : [];
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
        id: profileSummaryVersionId,
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
    ...shareProjectionInserts,
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
