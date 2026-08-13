import { DO } from "@me-builder/lib";
import type { DiaryBrainCheckpointCandidate } from "@me-builder/lib";

/** Diary source, session, message and turn operations owned by one AccountData Object. */
export const diaryActions = {
  "conversation.storeLineTextSource": (
    db: DO.account.Database,
    accountId: string,
    input: Omit<Parameters<typeof DO.account.action.diary.storeLineTextSource>[1], "accountId">,
  ) => DO.account.action.diary.storeLineTextSource(db, { ...input, accountId }),
  "conversation.prepareDailyPrompt": (
    db: DO.account.Database,
    accountId: string,
    input: Parameters<typeof DO.account.action.diary.prepareDailyPrompt>[2],
  ) => DO.account.action.diary.prepareDailyPrompt(db, accountId, input),
  "conversation.markDailyPromptDelivered": (
    db: DO.account.Database,
    accountId: string,
    deliveryId: string,
    at?: Date,
  ) => DO.account.action.diary.markDailyPromptDelivered(db, accountId, deliveryId, at),
  "conversation.markDailyPromptFailed": (
    db: DO.account.Database,
    accountId: string,
    deliveryId: string,
    failureStage: string,
    at?: Date,
  ) => DO.account.action.diary.markDailyPromptFailed(db, accountId, deliveryId, failureStage, at),
  "conversation.attachMessagesToTurn": (
    db: DO.account.Database,
    accountId: string,
    ...args: Parameters<typeof DO.account.action.diary.attachMessagesToTurn> extends [
      unknown,
      unknown,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) => DO.account.action.diary.attachMessagesToTurn(db, accountId, ...args),
  "conversation.getTurnContext": (
    db: DO.account.Database,
    _accountId: string,
    ...args: Parameters<typeof DO.account.action.diary.getTurnContext> extends [
      unknown,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) => DO.account.action.diary.getTurnContext(db, ...args),
  "conversation.claimDueDiaryBrainCheckpoints": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
  ) => DO.account.action.diary.claimDueDiaryBrainCheckpointIds(db, accountId, at),
  "conversation.resetFailedDiaryBrainCheckpoint": (
    db: DO.account.Database,
    accountId: string,
    checkpointId: string,
    at?: Date,
  ) => DO.account.action.diary.resetFailedDiaryBrainCheckpoint(db, accountId, checkpointId, at),
  "conversation.getDiaryBrainCheckpointContext": (
    db: DO.account.Database,
    accountId: string,
    checkpointId: string,
  ) => DO.account.action.diary.getDiaryBrainCheckpointContext(db, accountId, checkpointId),
  "conversation.applyDiaryBrainCheckpoint": (
    db: DO.account.Database,
    accountId: string,
    checkpointId: string,
    expectedThroughSequence: number,
    promptVersion: string,
    candidates: readonly DiaryBrainCheckpointCandidate[],
    at?: Date,
  ) =>
    DO.account.action.diary.applyDiaryBrainCheckpoint(
      db,
      accountId,
      checkpointId,
      expectedThroughSequence,
      promptVersion,
      candidates,
      at,
    ),
  "conversation.getDiaryBrainCheckpointDevelopmentNotification": (
    db: DO.account.Database,
    accountId: string,
    checkpointId: string,
  ) =>
    DO.account.action.diary.getDiaryBrainCheckpointDevelopmentNotification(
      db,
      accountId,
      checkpointId,
    ),
  "conversation.markDiaryBrainCheckpointDevelopmentNotificationSent": (
    db: DO.account.Database,
    accountId: string,
    checkpointId: string,
    at?: Date,
  ) =>
    DO.account.action.diary.markDiaryBrainCheckpointDevelopmentNotificationSent(
      db,
      accountId,
      checkpointId,
      at,
    ),
  "conversation.markTurnGenerating": (
    db: DO.account.Database,
    _accountId: string,
    turnId: string,
  ) => DO.account.action.diary.markTurnGenerating(db, turnId),
  "conversation.getTurnStatus": (db: DO.account.Database, _accountId: string, turnId: string) =>
    DO.account.action.diary.getTurnStatus(db, turnId),
  "conversation.isTurnSessionActive": (
    db: DO.account.Database,
    _accountId: string,
    turnId: string,
  ) => DO.account.action.diary.isTurnSessionActive(db, turnId),
  "conversation.saveAssistantResponse": (
    db: DO.account.Database,
    accountId: string,
    input: Parameters<typeof DO.account.action.diary.saveAssistantResponse>[2],
  ) => DO.account.action.diary.saveAssistantResponse(db, accountId, input),
  "conversation.getPendingAssistantResponse": (
    db: DO.account.Database,
    accountId: string,
    turnId: string,
  ) => DO.account.action.diary.getPendingAssistantResponse(db, accountId, turnId),
  "conversation.closeTurnSession": (db: DO.account.Database, _accountId: string, turnId: string) =>
    DO.account.action.diary.closeTurnSession(db, turnId),
  "conversation.markTurnDelivered": (db: DO.account.Database, _accountId: string, turnId: string) =>
    DO.account.action.diary.markTurnDelivered(db, turnId),
  "conversation.markTurnFailed": (
    db: DO.account.Database,
    _accountId: string,
    turnId: string,
    failureStage: string,
  ) => DO.account.action.diary.markTurnFailed(db, turnId, failureStage),
} as const;
