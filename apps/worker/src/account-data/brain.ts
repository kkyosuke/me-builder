import { type AppliedBrainVectorSync, DO } from "@me-builder/lib";

/** Brain Item domain operations owned by one AccountData Object. */
export const brainActions = {
  "brain.listActive": (db: DO.account.Database, accountId: string) =>
    DO.account.action.brain.listActiveBrainItems(db, accountId),
  "brain.findActiveVectorEntry": (
    db: DO.account.Database,
    accountId: string,
    brainItemId: string,
  ) => DO.account.action.brain.findActiveBrainVectorEntry(db, accountId, brainItemId),
  "brain.loadChatContextMemories": (
    db: DO.account.Database,
    accountId: string,
    vectorIds: readonly string[],
    at?: Date,
  ) => DO.account.action.brain.loadBrainChatContextMemories(db, accountId, vectorIds, at),
  "brain.loadSemanticDedupCandidates": (
    db: DO.account.Database,
    accountId: string,
    vectorIds: readonly string[],
    categories: readonly string[],
  ) =>
    DO.account.action.brain.loadBrainSemanticDedupCandidates(db, accountId, vectorIds, categories),
  "brain.getVectorSyncTarget": (
    db: DO.account.Database,
    accountId: string,
    jobId: string,
    brainItemId: string,
    itemRevision: number,
  ) =>
    DO.account.action.brain.getBrainVectorSyncTarget(
      db,
      accountId,
      jobId,
      brainItemId,
      itemRevision,
    ),
  "brain.completeVectorSyncJob": (
    db: DO.account.Database,
    accountId: string,
    jobId: string,
    applied: AppliedBrainVectorSync,
    mutationId: string,
    at?: Date,
  ) =>
    DO.account.action.brain.completeBrainVectorSyncJob(
      db,
      accountId,
      jobId,
      applied,
      mutationId,
      at,
    ),
  "brain.failVectorSyncJob": (
    db: DO.account.Database,
    _accountId: string,
    jobId: string,
    failureCode: string,
    retryable?: boolean,
    at?: Date,
  ) => DO.account.action.brain.failBrainVectorSyncJob(db, jobId, failureCode, retryable, at),
  "brain.resetFailedVectorSyncJob": (
    db: DO.account.Database,
    _accountId: string,
    jobId: string,
    at?: Date,
  ) => DO.account.action.brain.resetFailedBrainVectorSyncJob(db, jobId, at),
  "source.hasActive": (db: DO.account.Database, accountId: string) =>
    DO.account.action.source.hasActiveSourceRecords(db, accountId),
} as const;
