import {
  type AccountDataNamespace,
  type AvatarJobRecord,
  type AvatarState,
  type CreateAvatarJobResult,
  accountDataFor,
  type d1,
} from "@me-builder/lib";
import type { AvatarQueueMessage, Queue } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import { normalizeAvatarImage } from "../infrastructure/avatar-image";
import { createLiffSession } from "./liff-session";

const REFERENCE_RETENTION_MS = 24 * 60 * 60 * 1000;

export type PublicAvatarState = {
  currentAvatar: { id: string; imageUrl: string } | null;
  job: {
    id: string;
    status: AvatarJobRecord["status"];
    errorCode: string | null;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    candidates: Array<{ id: string; imageUrl: string; expiresAt: string }>;
  } | null;
};

type AvatarAuthFailure =
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type BaseParams = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  accountData: AccountDataNamespace;
};

type AvatarDependencies = {
  createSession: typeof createLiffSession;
  normalizeImage: typeof normalizeAvatarImage;
  createId: () => string;
};

type AvatarBucket = ApiBindings["AVATAR_BUCKET"];
type AvatarImages = ApiBindings["IMAGES"];

const defaultDependencies: AvatarDependencies = {
  createSession: createLiffSession,
  normalizeImage: normalizeAvatarImage,
  createId: () => crypto.randomUUID(),
};

function publicState(state: AvatarState): PublicAvatarState {
  return {
    currentAvatar: state.currentCandidate
      ? {
          id: state.currentCandidate.id,
          imageUrl: `/api/avatar/images/${state.currentCandidate.id}`,
        }
      : null,
    job: state.latestJob
      ? {
          id: state.latestJob.id,
          status: state.latestJob.status,
          errorCode: state.latestJob.errorCode,
          createdAt: state.latestJob.createdAt.toISOString(),
          updatedAt: state.latestJob.updatedAt.toISOString(),
          expiresAt: state.latestJob.expiresAt.toISOString(),
          candidates: state.latestJob.candidates.map((candidate) => ({
            id: candidate.id,
            imageUrl: `/api/avatar/images/${candidate.id}`,
            expiresAt: candidate.expiresAt.toISOString(),
          })),
        }
      : null,
  };
}

async function authenticate(
  params: BaseParams,
  dependencies: AvatarDependencies,
): Promise<{ type: "resolved"; accountId: string } | AvatarAuthFailure> {
  const session = await dependencies.createSession({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
  });
  if (session.type !== "resolved") return session;
  return { type: "resolved", accountId: session.session.accountId };
}

async function enqueue(
  accountData: AccountDataNamespace,
  accountId: string,
  queue: Queue<AvatarQueueMessage> | undefined,
  body: AvatarQueueMessage,
): Promise<void> {
  if (!queue) return;
  try {
    await queue.send(body);
    await accountDataFor(accountData, accountId).execute(
      "avatar.markEnqueued",
      body.jobId,
      body.operation,
    );
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Avatar Queue enqueue failed; AccountData alarm will retry",
    );
  }
}

export async function getAvatarState(
  params: BaseParams,
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<{ type: "resolved"; state: PublicAvatarState } | AvatarAuthFailure> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const state = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.getState",
  );
  return { type: "resolved", state: publicState(state) };
}

export async function uploadAvatarSource(
  params: BaseParams & {
    file: File;
    images: AvatarImages;
    bucket: AvatarBucket;
    queue?: Queue<AvatarQueueMessage>;
    at?: Date;
  },
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<{ type: "accepted"; state: PublicAvatarState } | AvatarAuthFailure> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const at = params.at ?? new Date();
  const normalized = await dependencies.normalizeImage(params.file, params.images);
  const jobId = dependencies.createId();
  const objectKey = `accounts/${session.accountId}/avatar/jobs/${jobId}/reference.webp`;
  await params.bucket.put(objectKey, normalized.bytes, {
    httpMetadata: { contentType: normalized.contentType },
  });
  let result: CreateAvatarJobResult;
  try {
    result = await accountDataFor(params.accountData, session.accountId).execute(
      "avatar.createJob",
      {
        id: jobId,
        referenceObjectKey: objectKey,
        referenceContentType: normalized.contentType,
        createdAt: at,
        expiresAt: new Date(at.getTime() + REFERENCE_RETENTION_MS),
      },
    );
  } catch (error) {
    await params.bucket.delete(objectKey);
    throw error;
  }
  if (result.type === "active-job") {
    await params.bucket.delete(objectKey);
  } else {
    await enqueue(params.accountData, session.accountId, params.queue, {
      type: "avatar",
      operation: "person-check",
      accountId: session.accountId,
      jobId,
    });
  }
  const state = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.getState",
    at,
  );
  return { type: "accepted", state: publicState(state) };
}

export async function startAvatarGeneration(
  params: BaseParams & { jobId: string; queue?: Queue<AvatarQueueMessage>; at?: Date },
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<
  | { type: "accepted"; state: PublicAvatarState }
  | { type: "job-not-found" }
  | { type: "rate-limited"; retryAt: string }
  | { type: "invalid-state" }
  | AvatarAuthFailure
> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const result = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.startGeneration",
    params.jobId,
    params.at,
  );
  if (result.type === "not-found") return { type: "job-not-found" };
  if (result.type === "rate-limited") {
    return { type: "rate-limited", retryAt: result.retryAt.toISOString() };
  }
  if (result.type === "invalid-state") return { type: "invalid-state" };
  if (result.job.queuePending) {
    await enqueue(params.accountData, session.accountId, params.queue, {
      type: "avatar",
      operation: "generate",
      accountId: session.accountId,
      jobId: params.jobId,
    });
  }
  const state = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.getState",
    params.at,
  );
  return { type: "accepted", state: publicState(state) };
}

export async function cancelAvatarJob(
  params: BaseParams & { jobId: string; bucket: AvatarBucket; at?: Date },
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<{ type: "cancelled" } | { type: "job-not-found" } | AvatarAuthFailure> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const job = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.cancelJob",
    params.jobId,
    params.at,
  );
  if (!job) return { type: "job-not-found" };
  await params.bucket.delete([
    job.referenceObjectKey,
    ...job.candidates.filter(({ selectedAt }) => !selectedAt).map(({ objectKey }) => objectKey),
  ]);
  return { type: "cancelled" };
}

export async function selectAvatar(
  params: BaseParams & { candidateId: string; bucket: AvatarBucket; at?: Date },
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<
  | { type: "selected"; state: PublicAvatarState }
  | { type: "candidate-not-found" }
  | { type: "invalid-state" }
  | AvatarAuthFailure
> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const result = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.selectCandidate",
    params.candidateId,
    params.at,
  );
  if (result.type === "not-found") return { type: "candidate-not-found" };
  if (result.type === "invalid-state") return result;
  if (result.previousObjectKey) await params.bucket.delete(result.previousObjectKey);
  return { type: "selected", state: publicState(result.state) };
}

export async function deleteAvatar(
  params: BaseParams & { bucket: AvatarBucket; at?: Date },
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<{ type: "deleted" } | AvatarAuthFailure> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const result = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.deleteCurrent",
    params.at,
  );
  if (result.previousObjectKey) await params.bucket.delete(result.previousObjectKey);
  return { type: "deleted" };
}

export async function getAvatarImage(
  params: BaseParams & { imageId: string; bucket: AvatarBucket; at?: Date },
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<
  | { type: "resolved-image"; body: ArrayBuffer; contentType: string; etag: string }
  | { type: "image-not-found" }
  | AvatarAuthFailure
> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const resolved = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.resolveImage",
    params.imageId,
    params.at,
  );
  if (resolved.type === "not-found") return { type: "image-not-found" };
  const object = await params.bucket.get(resolved.objectKey);
  if (!object) return { type: "image-not-found" };
  return {
    type: "resolved-image",
    body: await object.arrayBuffer(),
    contentType: resolved.contentType,
    etag: object.httpEtag,
  };
}
