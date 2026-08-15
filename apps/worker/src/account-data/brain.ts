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
    notBefore?: Date,
  ) =>
    DO.account.action.brain.loadBrainChatContextMemories(db, accountId, vectorIds, at, notBefore),
  "brain.loadRelationshipDiagnosisContexts": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
  ) => DO.account.action.brain.loadRelationshipDiagnosisContexts(db, accountId, at),
  "brain.listActivePromptContextKinds": (db: DO.account.Database, accountId: string, at?: Date) =>
    DO.account.action.brain.listActivePromptContextKinds(db, accountId, at),
  "brain.selectDailyPromptWeekdayContext": (
    db: DO.account.Database,
    accountId: string,
    weekday: Parameters<typeof DO.account.action.brain.selectDailyPromptWeekdayContext>[2],
    at?: Date,
  ) => DO.account.action.brain.selectDailyPromptWeekdayContext(db, accountId, weekday, at),
  "brain.selectDailyPromptStrategyPreference": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
  ) => DO.account.action.brain.selectDailyPromptStrategyPreference(db, accountId, at),
  "brain.selectDailyPromptTimePreference": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
  ) => DO.account.action.brain.selectDailyPromptTimePreference(db, accountId, at),
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
  "brain.listFailedVectorSyncJobs": (db: DO.account.Database, _accountId: string) =>
    DO.account.action.brain.listFailedBrainVectorSyncJobs(db),
  "brain.resetFailedVectorSyncJob": (
    db: DO.account.Database,
    _accountId: string,
    jobId: string,
    at?: Date,
  ) => DO.account.action.brain.resetFailedBrainVectorSyncJob(db, jobId, at),
  "brain.resetAllFailedVectorSyncJobs": (db: DO.account.Database, _accountId: string, at?: Date) =>
    DO.account.action.brain.resetAllFailedBrainVectorSyncJobs(db, at),
  "source.hasActive": (db: DO.account.Database, accountId: string) =>
    DO.account.action.source.hasActiveSourceRecords(db, accountId),
  "source.listPersonalData": (db: DO.account.Database, accountId: string) =>
    DO.account.action.source.listPersonalDataRecords(db, accountId),
  "source.correctPersonalData": (
    db: DO.account.Database,
    accountId: string,
    sourceRecordId: string,
    input: Parameters<typeof DO.account.action.source.correctPersonalDataRecord>[3],
    at?: Date,
  ) => DO.account.action.source.correctPersonalDataRecord(db, accountId, sourceRecordId, input, at),
  "source.deletePersonalData": (
    db: DO.account.Database,
    accountId: string,
    sourceRecordId: string,
    at?: Date,
  ) => DO.account.action.source.deletePersonalDataRecord(db, accountId, sourceRecordId, at),
} as const;
