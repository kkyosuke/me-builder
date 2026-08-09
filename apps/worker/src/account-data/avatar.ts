import type {
  AcquireAvatarTaskResult,
  AvatarCandidateRecord,
  AvatarJobRecord,
  AvatarQueueOperation,
  AvatarState,
  CreateAvatarJobInput,
  CreateAvatarJobResult,
  PendingAvatarEnqueue,
  ResolveAvatarImageResult,
  SelectAvatarCandidateResult,
  StartAvatarGenerationResult,
  d1,
} from "@me-builder/lib";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import {
  avatarCandidates,
  avatarGenerationEvents,
  avatarJobs,
  avatarObjectDeletions,
  avatarProfile,
} from "./avatar-schema";

const avatarSchema = {
  avatarCandidates,
  avatarGenerationEvents,
  avatarJobs,
  avatarObjectDeletions,
  avatarProfile,
};
type AvatarDatabase = DrizzleSqliteDODatabase<typeof avatarSchema>;
const PROCESSING_STATUSES: (typeof avatarJobs.$inferSelect.status)[] = [
  "checking",
  "accepted",
  "generating",
];
const CANDIDATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const REFERENCE_RETENTION_AFTER_GENERATION_MS = 24 * 60 * 60 * 1000;
const GENERATION_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const GENERATION_RATE_LIMIT = 3;

async function scheduleObjectDeletions(
  db: AvatarDatabase,
  items: Array<{ objectKey: string; deleteAfter: Date }>,
): Promise<void> {
  for (const item of items) {
    await db
      .insert(avatarObjectDeletions)
      .values({ ...item, attemptCount: 0, lastErrorCode: null })
      .onConflictDoUpdate({
        target: avatarObjectDeletions.objectKey,
        set: { deleteAfter: item.deleteAfter, attemptCount: 0, lastErrorCode: null },
      });
  }
}

function database(db: d1.Client): AvatarDatabase {
  return db as unknown as AvatarDatabase;
}

function candidateRecord(row: typeof avatarCandidates.$inferSelect): AvatarCandidateRecord {
  return row;
}

async function jobRecord(db: AvatarDatabase, jobId: string): Promise<AvatarJobRecord | null> {
  const row = await db.select().from(avatarJobs).where(eq(avatarJobs.id, jobId)).get();
  if (!row) return null;
  const candidates = await db
    .select()
    .from(avatarCandidates)
    .where(eq(avatarCandidates.jobId, jobId))
    .all();
  return { ...row, candidates: candidates.map(candidateRecord) };
}

async function getAvatarState(db: d1.Client, at = new Date()): Promise<AvatarState> {
  const client = database(db);
  const latest = await client
    .select()
    .from(avatarJobs)
    .orderBy(desc(avatarJobs.createdAt))
    .limit(1)
    .get();
  if (latest?.status === "ready" && latest.expiresAt <= at) {
    await client
      .update(avatarJobs)
      .set({ status: "expired", updatedAt: at })
      .where(eq(avatarJobs.id, latest.id));
  }
  const profile = await client
    .select({ currentCandidateId: avatarProfile.currentCandidateId })
    .from(avatarProfile)
    .where(eq(avatarProfile.singleton, 1))
    .get();
  const currentCandidate = profile?.currentCandidateId
    ? await client
        .select()
        .from(avatarCandidates)
        .where(eq(avatarCandidates.id, profile.currentCandidateId))
        .get()
    : undefined;
  return {
    currentCandidate: currentCandidate ? candidateRecord(currentCandidate) : null,
    latestJob: latest ? await jobRecord(client, latest.id) : null,
  };
}

async function createAvatarJob(
  db: d1.Client,
  _accountId: string,
  input: CreateAvatarJobInput,
): Promise<CreateAvatarJobResult> {
  const client = database(db);
  const active = await client
    .select({ id: avatarJobs.id })
    .from(avatarJobs)
    .where(inArray(avatarJobs.status, PROCESSING_STATUSES))
    .orderBy(desc(avatarJobs.updatedAt))
    .limit(1)
    .get();
  if (active) {
    const job = await jobRecord(client, active.id);
    if (!job) throw new Error("Active avatar job disappeared");
    return { type: "active-job", job };
  }

  await client
    .update(avatarJobs)
    .set({
      status: "cancelled",
      pendingOperation: null,
      queuePending: false,
      updatedAt: input.createdAt,
    })
    .where(eq(avatarJobs.status, "verified"));
  await client.insert(avatarJobs).values({
    ...input,
    status: "checking",
    pendingOperation: "person-check",
    queuePending: true,
    nextEnqueueAt: input.createdAt,
    processingLeaseExpiresAt: null,
    attemptCount: 0,
    errorCode: null,
    model: null,
    updatedAt: input.createdAt,
  });
  const job = await jobRecord(client, input.id);
  if (!job) throw new Error("Created avatar job could not be read");
  return { type: "created", job };
}

async function failAvatarJob(
  db: d1.Client,
  _accountId: string,
  jobId: string,
  errorCode: string,
  at = new Date(),
): Promise<void> {
  await database(db)
    .update(avatarJobs)
    .set({
      status: "failed",
      errorCode,
      pendingOperation: null,
      queuePending: false,
      processingLeaseExpiresAt: null,
      updatedAt: at,
    })
    .where(eq(avatarJobs.id, jobId));
}

async function markAvatarEnqueued(
  db: d1.Client,
  _accountId: string,
  jobId: string,
  operation: AvatarQueueOperation,
  at = new Date(),
): Promise<void> {
  await database(db)
    .update(avatarJobs)
    .set({ queuePending: false, nextEnqueueAt: null, updatedAt: at })
    .where(and(eq(avatarJobs.id, jobId), eq(avatarJobs.pendingOperation, operation)));
}

async function startAvatarGeneration(
  db: d1.Client,
  _accountId: string,
  jobId: string,
  at = new Date(),
): Promise<StartAvatarGenerationResult> {
  const client = database(db);
  const requestedAt = at ?? new Date();
  const existing = await jobRecord(client, jobId);
  if (!existing) return { type: "not-found" };
  if (existing.status === "ready" && existing.expiresAt <= requestedAt) {
    return { type: "invalid-state", job: existing };
  }
  if (["accepted", "generating", "ready"].includes(existing.status)) {
    return { type: "accepted", job: existing };
  }
  const retryableGenerationFailure =
    existing.status === "failed" && existing.errorCode === "generation_failed";
  if (
    (existing.status !== "verified" && !retryableGenerationFailure) ||
    existing.expiresAt <= requestedAt
  ) {
    return { type: "invalid-state", job: existing };
  }
  const otherActiveJob = await client
    .select({ id: avatarJobs.id })
    .from(avatarJobs)
    .where(and(ne(avatarJobs.id, jobId), inArray(avatarJobs.status, PROCESSING_STATUSES)))
    .limit(1)
    .get();
  if (otherActiveJob) return { type: "invalid-state", job: existing };
  if (!retryableGenerationFailure) {
    const windowStart = new Date(requestedAt.getTime() - GENERATION_RATE_WINDOW_MS);
    const usage = await client
      .select({ value: count() })
      .from(avatarGenerationEvents)
      .where(gte(avatarGenerationEvents.startedAt, windowStart))
      .get();
    if ((usage?.value ?? 0) >= GENERATION_RATE_LIMIT) {
      const oldest = await client
        .select({ startedAt: avatarGenerationEvents.startedAt })
        .from(avatarGenerationEvents)
        .where(gte(avatarGenerationEvents.startedAt, windowStart))
        .orderBy(asc(avatarGenerationEvents.startedAt))
        .limit(1)
        .get();
      return {
        type: "rate-limited",
        retryAt: new Date((oldest?.startedAt ?? requestedAt).getTime() + GENERATION_RATE_WINDOW_MS),
      };
    }
    await client
      .insert(avatarGenerationEvents)
      .values({ jobId, startedAt: requestedAt })
      .onConflictDoNothing();
  }
  await client
    .delete(avatarObjectDeletions)
    .where(eq(avatarObjectDeletions.objectKey, existing.referenceObjectKey));
  await client
    .update(avatarJobs)
    .set({
      status: "accepted",
      pendingOperation: "generate",
      queuePending: true,
      nextEnqueueAt: requestedAt,
      processingLeaseExpiresAt: null,
      attemptCount: 0,
      errorCode: null,
      updatedAt: requestedAt,
    })
    .where(eq(avatarJobs.id, jobId));
  const job = await jobRecord(client, jobId);
  if (!job) throw new Error("Accepted avatar job could not be read");
  return { type: "accepted", job };
}

async function cancelAvatarJob(
  db: d1.Client,
  _accountId: string,
  jobId: string,
  at = new Date(),
): Promise<AvatarJobRecord | null> {
  const client = database(db);
  const existing = await jobRecord(client, jobId);
  if (!existing) return null;
  await scheduleObjectDeletions(client, [
    { objectKey: existing.referenceObjectKey, deleteAfter: at },
    ...existing.candidates
      .filter(({ selectedAt }) => !selectedAt)
      .map(({ objectKey }) => ({ objectKey, deleteAfter: at })),
  ]);
  if (!["selected", "expired"].includes(existing.status)) {
    await client
      .update(avatarJobs)
      .set({
        status: "cancelled",
        pendingOperation: null,
        queuePending: false,
        processingLeaseExpiresAt: null,
        updatedAt: at,
      })
      .where(eq(avatarJobs.id, jobId));
  }
  return jobRecord(client, jobId);
}

async function selectAvatarCandidate(
  db: d1.Client,
  _accountId: string,
  candidateId: string,
  at = new Date(),
): Promise<SelectAvatarCandidateResult> {
  const client = database(db);
  const candidate = await client
    .select()
    .from(avatarCandidates)
    .where(eq(avatarCandidates.id, candidateId))
    .get();
  if (!candidate) return { type: "not-found" };
  const job = await client
    .select()
    .from(avatarJobs)
    .where(eq(avatarJobs.id, candidate.jobId))
    .get();
  if (!job || job.status !== "ready" || candidate.expiresAt <= at) {
    return { type: "invalid-state" };
  }
  const profile = await client
    .select()
    .from(avatarProfile)
    .where(eq(avatarProfile.singleton, 1))
    .get();
  const previous = profile?.currentCandidateId
    ? await client
        .select({ objectKey: avatarCandidates.objectKey })
        .from(avatarCandidates)
        .where(eq(avatarCandidates.id, profile.currentCandidateId))
        .get()
    : undefined;
  await client
    .delete(avatarObjectDeletions)
    .where(eq(avatarObjectDeletions.objectKey, candidate.objectKey));
  if (previous?.objectKey && previous.objectKey !== candidate.objectKey) {
    await scheduleObjectDeletions(client, [{ objectKey: previous.objectKey, deleteAfter: at }]);
  }
  await client
    .insert(avatarProfile)
    .values({ singleton: 1, currentCandidateId: candidateId, updatedAt: at })
    .onConflictDoUpdate({
      target: avatarProfile.singleton,
      set: { currentCandidateId: candidateId, updatedAt: at },
    });
  await client
    .update(avatarCandidates)
    .set({ selectedAt: at })
    .where(eq(avatarCandidates.id, candidateId));
  await client
    .update(avatarJobs)
    .set({ status: "selected", updatedAt: at })
    .where(eq(avatarJobs.id, candidate.jobId));
  return {
    type: "selected",
    state: await getAvatarState(db, at),
    previousObjectKey:
      previous?.objectKey && previous.objectKey !== candidate.objectKey ? previous.objectKey : null,
  };
}

async function deleteCurrentAvatar(
  db: d1.Client,
  _accountId: string,
  at = new Date(),
): Promise<{ previousObjectKey: string | null }> {
  const client = database(db);
  const profile = await client
    .select()
    .from(avatarProfile)
    .where(eq(avatarProfile.singleton, 1))
    .get();
  const previous = profile?.currentCandidateId
    ? await client
        .select({ objectKey: avatarCandidates.objectKey })
        .from(avatarCandidates)
        .where(eq(avatarCandidates.id, profile.currentCandidateId))
        .get()
    : undefined;
  if (previous?.objectKey) {
    await scheduleObjectDeletions(client, [{ objectKey: previous.objectKey, deleteAfter: at }]);
  }
  await client
    .insert(avatarProfile)
    .values({ singleton: 1, currentCandidateId: null, updatedAt: at })
    .onConflictDoUpdate({
      target: avatarProfile.singleton,
      set: { currentCandidateId: null, updatedAt: at },
    });
  return { previousObjectKey: previous?.objectKey ?? null };
}

async function resolveAvatarImage(
  db: d1.Client,
  _accountId: string,
  imageId: string,
  at = new Date(),
): Promise<ResolveAvatarImageResult> {
  const client = database(db);
  const candidate = await client
    .select()
    .from(avatarCandidates)
    .where(eq(avatarCandidates.id, imageId))
    .get();
  if (!candidate) return { type: "not-found" };
  const job = await client
    .select({ status: avatarJobs.status })
    .from(avatarJobs)
    .where(eq(avatarJobs.id, candidate.jobId))
    .get();
  const selectable = job?.status === "ready" && candidate.expiresAt > at;
  if (!selectable && candidate.selectedAt === null) return { type: "not-found" };
  return { type: "resolved", objectKey: candidate.objectKey, contentType: candidate.contentType };
}

async function acquireAvatarTask(
  db: d1.Client,
  _accountId: string,
  jobId: string,
  operation: AvatarQueueOperation,
  leaseExpiresAt: Date,
  at = new Date(),
): Promise<AcquireAvatarTaskResult> {
  const client = database(db);
  const job = await jobRecord(client, jobId);
  if (!job) return { type: "skip", reason: "not-found" };
  if (
    ["not_person", "verified", "ready", "failed", "cancelled", "selected", "expired"].includes(
      job.status,
    )
  ) {
    return { type: "skip", reason: "terminal" };
  }
  if (job.pendingOperation !== operation) return { type: "skip", reason: "wrong-operation" };
  if (job.processingLeaseExpiresAt && job.processingLeaseExpiresAt > at) {
    return { type: "skip", reason: "leased" };
  }
  if (operation === "person-check" && job.status !== "checking") {
    return { type: "skip", reason: "wrong-operation" };
  }
  if (operation === "generate" && !["accepted", "generating"].includes(job.status)) {
    return { type: "skip", reason: "wrong-operation" };
  }
  await client
    .update(avatarJobs)
    .set({
      status: operation === "generate" ? "generating" : "checking",
      queuePending: false,
      processingLeaseExpiresAt: leaseExpiresAt,
      attemptCount: job.attemptCount + 1,
      updatedAt: at,
    })
    .where(eq(avatarJobs.id, jobId));
  const acquired = await jobRecord(client, jobId);
  if (!acquired) throw new Error("Acquired avatar job disappeared");
  return { type: "acquired", job: acquired };
}

async function finishPersonCheck(
  db: d1.Client,
  _accountId: string,
  jobId: string,
  hasPerson: boolean,
  at = new Date(),
): Promise<AvatarJobRecord | null> {
  const client = database(db);
  const existing = await jobRecord(client, jobId);
  if (!existing || existing.status !== "checking") return existing;
  await client
    .update(avatarJobs)
    .set({
      status: hasPerson ? "verified" : "not_person",
      pendingOperation: null,
      queuePending: false,
      processingLeaseExpiresAt: null,
      errorCode: null,
      updatedAt: at,
    })
    .where(and(eq(avatarJobs.id, jobId), eq(avatarJobs.status, "checking")));
  await scheduleObjectDeletions(client, [
    {
      objectKey: existing.referenceObjectKey,
      deleteAfter: hasPerson ? existing.expiresAt : at,
    },
  ]);
  return jobRecord(client, jobId);
}

async function addAvatarCandidate(
  db: d1.Client,
  _accountId: string,
  candidate: AvatarCandidateRecord,
): Promise<boolean> {
  const client = database(db);
  const job = await client
    .select({ status: avatarJobs.status })
    .from(avatarJobs)
    .where(eq(avatarJobs.id, candidate.jobId))
    .get();
  if (job?.status !== "generating") return false;
  await client.insert(avatarCandidates).values(candidate).onConflictDoNothing();
  return true;
}

async function finishAvatarGeneration(
  db: d1.Client,
  _accountId: string,
  jobId: string,
  model: string,
  at = new Date(),
): Promise<AvatarJobRecord | null> {
  const client = database(db);
  const job = await jobRecord(client, jobId);
  if (!job || job.status !== "generating") return job;
  const candidates = await client
    .select({ id: avatarCandidates.id })
    .from(avatarCandidates)
    .where(eq(avatarCandidates.jobId, jobId))
    .all();
  await client
    .update(avatarJobs)
    .set({
      status: candidates.length > 0 ? "ready" : "failed",
      pendingOperation: null,
      queuePending: false,
      processingLeaseExpiresAt: null,
      errorCode: candidates.length > 0 ? null : "generation_failed",
      model,
      expiresAt:
        candidates.length > 0 ? new Date(at.getTime() + CANDIDATE_RETENTION_MS) : job.expiresAt,
      updatedAt: at,
    })
    .where(eq(avatarJobs.id, jobId));
  await scheduleObjectDeletions(client, [
    {
      objectKey: job.referenceObjectKey,
      deleteAfter:
        candidates.length > 0
          ? new Date(at.getTime() + REFERENCE_RETENTION_AFTER_GENERATION_MS)
          : job.expiresAt,
    },
    ...job.candidates.map(({ objectKey, expiresAt }) => ({ objectKey, deleteAfter: expiresAt })),
  ]);
  return jobRecord(client, jobId);
}

async function releaseAvatarTask(
  db: d1.Client,
  _accountId: string,
  jobId: string,
  operation: AvatarQueueOperation,
  terminal: boolean,
  errorCode: string,
  at = new Date(),
): Promise<void> {
  const client = database(db);
  const existing = await jobRecord(client, jobId);
  const processingStatus = operation === "generate" ? "generating" : "checking";
  if (!existing || existing.status !== processingStatus) return;
  await client
    .update(avatarJobs)
    .set({
      status: terminal ? "failed" : operation === "generate" ? "accepted" : "checking",
      pendingOperation: terminal ? null : operation,
      processingLeaseExpiresAt: null,
      errorCode,
      updatedAt: at,
    })
    .where(eq(avatarJobs.id, jobId));
  if (terminal) {
    await scheduleObjectDeletions(client, [
      { objectKey: existing.referenceObjectKey, deleteAfter: existing.expiresAt },
      ...existing.candidates.map(({ objectKey, expiresAt }) => ({
        objectKey,
        deleteAfter: expiresAt,
      })),
    ]);
  }
}

export async function listPendingAvatarObjectDeletions(
  db: d1.Client,
  at = new Date(),
): Promise<Array<{ objectKey: string; attemptCount: number }>> {
  return database(db)
    .select({
      objectKey: avatarObjectDeletions.objectKey,
      attemptCount: avatarObjectDeletions.attemptCount,
    })
    .from(avatarObjectDeletions)
    .where(lte(avatarObjectDeletions.deleteAfter, at))
    .orderBy(asc(avatarObjectDeletions.deleteAfter))
    .limit(20)
    .all();
}

export async function markAvatarObjectDeleted(db: d1.Client, objectKey: string): Promise<void> {
  await database(db)
    .delete(avatarObjectDeletions)
    .where(eq(avatarObjectDeletions.objectKey, objectKey));
}

export async function retryAvatarObjectDeletion(
  db: d1.Client,
  objectKey: string,
  attemptCount: number,
  at = new Date(),
): Promise<void> {
  const delayMs = Math.min(60 * 60 * 1000, 2 ** Math.min(attemptCount, 10) * 60 * 1000);
  await database(db)
    .update(avatarObjectDeletions)
    .set({
      attemptCount: attemptCount + 1,
      lastErrorCode: "r2_delete_failed",
      deleteAfter: new Date(at.getTime() + delayMs),
    })
    .where(eq(avatarObjectDeletions.objectKey, objectKey));
}

async function listPendingAvatarEnqueues(
  db: d1.Client,
  _accountId: string,
  at = new Date(),
): Promise<PendingAvatarEnqueue[]> {
  const rows = await database(db)
    .select({ jobId: avatarJobs.id, operation: avatarJobs.pendingOperation })
    .from(avatarJobs)
    .where(
      and(
        eq(avatarJobs.queuePending, true),
        isNotNull(avatarJobs.pendingOperation),
        lte(avatarJobs.nextEnqueueAt, at),
      ),
    )
    .all();
  return rows.flatMap(({ jobId, operation }) => (operation ? [{ jobId, operation }] : []));
}

export const avatarActions = {
  "avatar.getState": (db: d1.Client, _accountId: string, at?: Date) => getAvatarState(db, at),
  "avatar.createJob": createAvatarJob,
  "avatar.failJob": failAvatarJob,
  "avatar.markEnqueued": markAvatarEnqueued,
  "avatar.startGeneration": startAvatarGeneration,
  "avatar.cancelJob": cancelAvatarJob,
  "avatar.selectCandidate": selectAvatarCandidate,
  "avatar.deleteCurrent": deleteCurrentAvatar,
  "avatar.resolveImage": resolveAvatarImage,
  "avatar.acquireTask": acquireAvatarTask,
  "avatar.finishPersonCheck": finishPersonCheck,
  "avatar.addCandidate": addAvatarCandidate,
  "avatar.finishGeneration": finishAvatarGeneration,
  "avatar.releaseTask": releaseAvatarTask,
  "avatar.listPendingEnqueues": listPendingAvatarEnqueues,
} as const;
