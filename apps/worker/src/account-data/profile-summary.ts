import {
  type CompleteProfileSummaryGenerationInput,
  type CompleteWeeklyReflectionGenerationInput,
  DO,
} from "@me-builder/lib";

/** Profile Summary generation and immutable version operations owned by one AccountData Object. */
export const profileSummaryActions = {
  "progression.read": (db: DO.account.Database, accountId: string, at?: Date) =>
    DO.account.action.progression.readUtsushiProgression(db, accountId, at),
  "profileSummary.read": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
    allowUnchangedRegeneration?: boolean,
  ) =>
    DO.account.action.profileSummary.readProfileSummary(
      db,
      accountId,
      at,
      allowUnchangedRegeneration,
    ),
  "profileSummary.readCompatibilityShareProfile": (db: DO.account.Database, accountId: string) =>
    DO.account.action.profileSummary.readCompatibilityShareProfile(db, accountId),
  "profileSummary.requestGeneration": (
    db: DO.account.Database,
    accountId: string,
    requestedAt?: Date,
    allowUnchangedRegeneration?: boolean,
  ) =>
    DO.account.action.profileSummary.requestProfileSummaryGeneration(
      db,
      accountId,
      requestedAt,
      allowUnchangedRegeneration,
    ),
  "profileSummary.listUndispatchedGenerationIds": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
    limit?: number,
  ) =>
    DO.account.action.profileSummary.listUndispatchedProfileSummaryGenerationIds(
      db,
      accountId,
      at,
      limit,
    ),
  "profileSummary.markGenerationDispatched": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
    dispatchedAt?: Date,
  ) =>
    DO.account.action.profileSummary.markProfileSummaryGenerationDispatched(
      db,
      accountId,
      generationId,
      dispatchedAt,
    ),
  "profileSummary.loadGenerationContext": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
    startedAt?: Date,
  ) =>
    DO.account.action.profileSummary.loadProfileSummaryGenerationContext(
      db,
      accountId,
      generationId,
      startedAt,
    ),
  "profileSummary.readGenerationStatus": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
  ) =>
    DO.account.action.profileSummary.readProfileSummaryGenerationStatus(
      db,
      accountId,
      generationId,
    ),
  "profileSummary.completeGeneration": (
    db: DO.account.Database,
    accountId: string,
    input: CompleteProfileSummaryGenerationInput,
  ) => DO.account.action.profileSummary.completeProfileSummaryGeneration(db, accountId, input),
  "profileSummary.failGeneration": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
    message: string,
    failedAt?: Date,
  ) =>
    DO.account.action.profileSummary.failProfileSummaryGeneration(
      db,
      accountId,
      generationId,
      message,
      failedAt,
    ),
  "weeklyReflection.read": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
    monthlyMode?: "none" | "brief" | "full",
  ) => DO.account.action.weeklyReflection.readWeeklyReflections(db, accountId, at, monthlyMode),
  "weeklyReflection.requestGeneration": (
    db: DO.account.Database,
    accountId: string,
    requestedAt?: Date,
  ) =>
    DO.account.action.weeklyReflection.requestWeeklyReflectionGeneration(
      db,
      accountId,
      requestedAt,
    ),
  "weeklyReflection.listUndispatchedGenerationIds": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
    limit?: number,
  ) =>
    DO.account.action.weeklyReflection.listUndispatchedWeeklyReflectionGenerationIds(
      db,
      accountId,
      at,
      limit,
    ),
  "weeklyReflection.markGenerationDispatched": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
    dispatchedAt?: Date,
  ) =>
    DO.account.action.weeklyReflection.markWeeklyReflectionGenerationDispatched(
      db,
      accountId,
      generationId,
      dispatchedAt,
    ),
  "weeklyReflection.loadGenerationContext": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
    startedAt?: Date,
  ) =>
    DO.account.action.weeklyReflection.loadWeeklyReflectionGenerationContext(
      db,
      accountId,
      generationId,
      startedAt,
    ),
  "weeklyReflection.completeGeneration": (
    db: DO.account.Database,
    accountId: string,
    input: CompleteWeeklyReflectionGenerationInput,
  ) => DO.account.action.weeklyReflection.completeWeeklyReflectionGeneration(db, accountId, input),
  "weeklyReflection.failGeneration": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
    message: string,
    failedAt?: Date,
  ) =>
    DO.account.action.weeklyReflection.failWeeklyReflectionGeneration(
      db,
      accountId,
      generationId,
      message,
      failedAt,
    ),
} as const;
