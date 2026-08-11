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
    at?: Date,
  ) => DO.account.action.brain.failBrainVectorSyncJob(db, jobId, failureCode, at),
  "source.hasActive": (db: DO.account.Database, accountId: string) =>
    DO.account.action.source.hasActiveSourceRecords(db, accountId),
} as const;
