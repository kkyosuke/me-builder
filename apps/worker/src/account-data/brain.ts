import { d1 } from "@me-builder/lib";

/** Brain Item domain operations owned by one AccountData Object. */
export const brainActions = {
  "brain.listActive": (db: d1.Client, accountId: string) =>
    d1.action.brain.listActiveBrainItems(db, accountId),
  "brain.getVectorSyncTarget": (
    db: d1.Client,
    accountId: string,
    jobId: string,
    brainItemId: string,
    itemRevision: number,
  ) => d1.action.brain.getBrainVectorSyncTarget(db, accountId, jobId, brainItemId, itemRevision),
  "brain.completeVectorSyncJob": (
    db: d1.Client,
    accountId: string,
    jobId: string,
    mutationId: string,
    at?: Date,
  ) => d1.action.brain.completeBrainVectorSyncJob(db, accountId, jobId, mutationId, at),
  "brain.failVectorSyncJob": (
    db: d1.Client,
    accountId: string,
    jobId: string,
    failureCode: string,
    at?: Date,
  ) => d1.action.brain.failBrainVectorSyncJob(db, accountId, jobId, failureCode, at),
  "source.hasActive": (db: d1.Client, accountId: string) =>
    d1.action.source.hasActiveSourceRecords(db, accountId),
} as const;
