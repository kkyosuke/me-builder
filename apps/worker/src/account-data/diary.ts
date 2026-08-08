import { d1 } from "@me-builder/lib";

/** Diary source, session, message and turn operations owned by one AccountData Object. */
export const diaryActions = {
  "conversation.storeLineTextSource": d1.action.conversation.storeLineTextSource,
  "conversation.attachMessagesToTurn": d1.action.conversation.attachMessagesToTurn,
  "conversation.getTurnContext": d1.action.conversation.getTurnContext,
  "conversation.markTurnGenerating": d1.action.conversation.markTurnGenerating,
  "conversation.getTurnStatus": d1.action.conversation.getTurnStatus,
  "conversation.isTurnSessionActive": d1.action.conversation.isTurnSessionActive,
  "conversation.saveAssistantResponse": d1.action.conversation.saveAssistantResponse,
  "conversation.getPendingAssistantResponse": d1.action.conversation.getPendingAssistantResponse,
  "conversation.closeTurnSession": d1.action.conversation.closeTurnSession,
  "conversation.closeExpiredSessions": d1.action.conversation.closeExpiredSessions,
  "conversation.markTurnDelivered": d1.action.conversation.markTurnDelivered,
  "conversation.markTurnFailed": d1.action.conversation.markTurnFailed,
} as const;
