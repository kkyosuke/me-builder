import { accountData } from "@me-builder/lib";

/** Diary source, session, message and turn operations owned by one AccountData Object. */
export const diaryActions = {
  "conversation.storeLineTextSource": (
    db: accountData.Database,
    accountId: string,
    input: Omit<Parameters<typeof accountData.action.diary.storeLineTextSource>[1], "accountId">,
  ) => accountData.action.diary.storeLineTextSource(db, { ...input, accountId }),
  "conversation.attachMessagesToTurn": (
    db: accountData.Database,
    accountId: string,
    ...args: Parameters<typeof accountData.action.diary.attachMessagesToTurn> extends [
      unknown,
      unknown,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) => accountData.action.diary.attachMessagesToTurn(db, accountId, ...args),
  "conversation.getTurnContext": (
    db: accountData.Database,
    _accountId: string,
    ...args: Parameters<typeof accountData.action.diary.getTurnContext> extends [
      unknown,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) => accountData.action.diary.getTurnContext(db, ...args),
  "conversation.claimDueDiaryBrainCheckpoints": (
    db: accountData.Database,
    accountId: string,
    at?: Date,
  ) => accountData.action.diary.claimDueDiaryBrainCheckpointIds(db, accountId, at),
  "conversation.getDiaryBrainCheckpointContext": (
    db: accountData.Database,
    accountId: string,
    checkpointId: string,
  ) => accountData.action.diary.getDiaryBrainCheckpointContext(db, accountId, checkpointId),
  "conversation.applyDiaryBrainCheckpoint": (
    db: accountData.Database,
    accountId: string,
    checkpointId: string,
    expectedThroughSequence: number,
    promptVersion: string,
    candidates: readonly { statement: string; sourceMessageIds: readonly string[] }[],
    at?: Date,
  ) =>
    accountData.action.diary.applyDiaryBrainCheckpoint(
      db,
      accountId,
      checkpointId,
      expectedThroughSequence,
      promptVersion,
      candidates,
      at,
    ),
  "conversation.getDiaryBrainCheckpointDevelopmentNotification": (
    db: accountData.Database,
    accountId: string,
    checkpointId: string,
  ) =>
    accountData.action.diary.getDiaryBrainCheckpointDevelopmentNotification(
      db,
      accountId,
      checkpointId,
    ),
  "conversation.markDiaryBrainCheckpointDevelopmentNotificationSent": (
    db: accountData.Database,
    accountId: string,
    checkpointId: string,
    at?: Date,
  ) =>
    accountData.action.diary.markDiaryBrainCheckpointDevelopmentNotificationSent(
      db,
      accountId,
      checkpointId,
      at,
    ),
  "conversation.markTurnGenerating": (
    db: accountData.Database,
    _accountId: string,
    turnId: string,
  ) => accountData.action.diary.markTurnGenerating(db, turnId),
  "conversation.getTurnStatus": (db: accountData.Database, _accountId: string, turnId: string) =>
    accountData.action.diary.getTurnStatus(db, turnId),
  "conversation.isTurnSessionActive": (
    db: accountData.Database,
    _accountId: string,
    turnId: string,
  ) => accountData.action.diary.isTurnSessionActive(db, turnId),
  "conversation.saveAssistantResponse": (
    db: accountData.Database,
    _accountId: string,
    input: Parameters<typeof accountData.action.diary.saveAssistantResponse>[1],
  ) => accountData.action.diary.saveAssistantResponse(db, input),
  "conversation.getPendingAssistantResponse": (
    db: accountData.Database,
    accountId: string,
    turnId: string,
  ) => accountData.action.diary.getPendingAssistantResponse(db, accountId, turnId),
  "conversation.closeTurnSession": (db: accountData.Database, _accountId: string, turnId: string) =>
    accountData.action.diary.closeTurnSession(db, turnId),
  "conversation.markTurnDelivered": (
    db: accountData.Database,
    _accountId: string,
    turnId: string,
  ) => accountData.action.diary.markTurnDelivered(db, turnId),
  "conversation.markTurnFailed": (
    db: accountData.Database,
    _accountId: string,
    turnId: string,
    failureStage: string,
  ) => accountData.action.diary.markTurnFailed(db, turnId, failureStage),
} as const;
