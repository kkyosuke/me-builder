import { d1 } from "@me-builder/lib";

/** Diary source, session, message and turn operations owned by one AccountData Object. */
export const diaryActions = {
  "conversation.storeLineTextSource": (
    db: d1.Client,
    accountId: string,
    input: Omit<Parameters<typeof d1.action.conversation.storeLineTextSource>[1], "accountId">,
  ) => d1.action.conversation.storeLineTextSource(db, { ...input, accountId }),
  "conversation.attachMessagesToTurn": (
    db: d1.Client,
    accountId: string,
    ...args: Parameters<typeof d1.action.conversation.attachMessagesToTurn> extends [
      unknown,
      unknown,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) => d1.action.conversation.attachMessagesToTurn(db, accountId, ...args),
  "conversation.getTurnContext": (
    db: d1.Client,
    _accountId: string,
    ...args: Parameters<typeof d1.action.conversation.getTurnContext> extends [
      unknown,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) => d1.action.conversation.getTurnContext(db, ...args),
  "conversation.listDueDiaryBrainCheckpoints": (db: d1.Client, accountId: string, at?: Date) =>
    d1.action.conversation.listDueDiaryBrainCheckpointIds(db, accountId, at),
  "conversation.deferDiaryBrainCheckpoint": (
    db: d1.Client,
    accountId: string,
    checkpointId: string,
    at?: Date,
  ) => d1.action.conversation.deferDiaryBrainCheckpoint(db, accountId, checkpointId, at),
  "conversation.getDiaryBrainCheckpointContext": (
    db: d1.Client,
    accountId: string,
    checkpointId: string,
  ) => d1.action.conversation.getDiaryBrainCheckpointContext(db, accountId, checkpointId),
  "conversation.applyDiaryBrainCheckpoint": (
    db: d1.Client,
    accountId: string,
    checkpointId: string,
    expectedThroughSequence: number,
    promptVersion: string,
    candidates: readonly { statement: string; sourceMessageIds: readonly string[] }[],
    at?: Date,
  ) =>
    d1.action.conversation.applyDiaryBrainCheckpoint(
      db,
      accountId,
      checkpointId,
      expectedThroughSequence,
      promptVersion,
      candidates,
      at,
    ),
  "conversation.markTurnGenerating": (db: d1.Client, _accountId: string, turnId: string) =>
    d1.action.conversation.markTurnGenerating(db, turnId),
  "conversation.getTurnStatus": (db: d1.Client, _accountId: string, turnId: string) =>
    d1.action.conversation.getTurnStatus(db, turnId),
  "conversation.isTurnSessionActive": (db: d1.Client, _accountId: string, turnId: string) =>
    d1.action.conversation.isTurnSessionActive(db, turnId),
  "conversation.saveAssistantResponse": (
    db: d1.Client,
    _accountId: string,
    input: Parameters<typeof d1.action.conversation.saveAssistantResponse>[1],
  ) => d1.action.conversation.saveAssistantResponse(db, input),
  "conversation.getPendingAssistantResponse": (db: d1.Client, accountId: string, turnId: string) =>
    d1.action.conversation.getPendingAssistantResponse(db, accountId, turnId),
  "conversation.closeTurnSession": (db: d1.Client, _accountId: string, turnId: string) =>
    d1.action.conversation.closeTurnSession(db, turnId),
  "conversation.markTurnDelivered": (db: d1.Client, _accountId: string, turnId: string) =>
    d1.action.conversation.markTurnDelivered(db, turnId),
  "conversation.markTurnFailed": (
    db: d1.Client,
    _accountId: string,
    turnId: string,
    failureStage: string,
  ) => d1.action.conversation.markTurnFailed(db, turnId, failureStage),
} as const;
