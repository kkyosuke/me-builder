export const AVATAR_JOB_STATUSES = [
  "checking",
  "not_person",
  "verified",
  "accepted",
  "generating",
  "ready",
  "failed",
  "cancelled",
  "selected",
  "expired",
] as const;

export type AvatarJobStatus = (typeof AVATAR_JOB_STATUSES)[number];
export type AvatarQueueOperation = "person-check" | "generate";

export type AvatarCandidateRecord = {
  id: string;
  jobId: string;
  objectKey: string;
  contentType: string;
  createdAt: Date;
  expiresAt: Date;
  selectedAt: Date | null;
};

export type AvatarJobRecord = {
  id: string;
  status: AvatarJobStatus;
  referenceObjectKey: string;
  referenceContentType: string;
  pendingOperation: AvatarQueueOperation | null;
  queuePending: boolean;
  nextEnqueueAt: Date | null;
  enqueueAttemptCount: number;
  processingLeaseExpiresAt: Date | null;
  attemptCount: number;
  errorCode: string | null;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  candidates: AvatarCandidateRecord[];
};

export type AvatarState = {
  currentCandidate: AvatarCandidateRecord | null;
  latestJob: AvatarJobRecord | null;
};

export type CreateAvatarJobInput = {
  id: string;
  referenceObjectKey: string;
  referenceContentType: string;
  createdAt: Date;
  expiresAt: Date;
};

export type CreateAvatarJobResult =
  | { type: "created"; job: AvatarJobRecord }
  | { type: "active-job"; job: AvatarJobRecord };

export type StartAvatarGenerationResult =
  | { type: "accepted"; job: AvatarJobRecord }
  | { type: "not-found" }
  | { type: "rate-limited"; retryAt: Date }
  | { type: "invalid-state"; job: AvatarJobRecord };

export type SelectAvatarCandidateResult =
  | { type: "selected"; state: AvatarState; previousObjectKey: string | null }
  | { type: "not-found" }
  | { type: "invalid-state" }
  | { type: "rate-limited"; retryAt: Date };

export type DeleteCurrentAvatarResult =
  | { type: "deleted"; previousObjectKey: string }
  | { type: "unchanged" }
  | { type: "rate-limited"; retryAt: Date };

export type ResolveAvatarImageResult =
  | { type: "resolved"; objectKey: string; contentType: string }
  | { type: "not-found" };

export type AcquireAvatarTaskResult =
  | { type: "acquired"; job: AvatarJobRecord }
  | { type: "skip"; reason: "not-found" | "terminal" | "wrong-operation" }
  | { type: "skip"; reason: "leased"; retryAt: Date };

export type PendingAvatarEnqueue = {
  jobId: string;
  operation: AvatarQueueOperation;
};
