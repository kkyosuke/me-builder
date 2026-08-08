import type * as brain from "./d1/action/brain";
import type * as conversation from "./d1/action/conversation";
import type * as diagnosis from "./d1/action/diagnosis";
import type * as diagnosisBrainProjection from "./d1/action/diagnosis-brain-projection";
import type * as source from "./d1/action/source";

type WithoutDatabase<T> = T extends (...args: infer TArgs) => unknown
  ? TArgs extends [unknown, ...infer TRest]
    ? TRest
    : never
  : never;
type ActionResult<T> = T extends (...args: never[]) => infer TResult ? Awaited<TResult> : never;

export type AccountDataActions = {
  "brain.save": typeof brain.saveBrainItem;
  "brain.find": typeof brain.findBrainItemForAccount;
  "source.hasActive": typeof source.hasActiveSourceRecords;
  "conversation.storeLineTextSource": typeof conversation.storeLineTextSource;
  "conversation.attachMessagesToTurn": typeof conversation.attachMessagesToTurn;
  "conversation.getTurnContext": typeof conversation.getTurnContext;
  "conversation.markTurnGenerating": typeof conversation.markTurnGenerating;
  "conversation.getTurnStatus": typeof conversation.getTurnStatus;
  "conversation.isTurnSessionActive": typeof conversation.isTurnSessionActive;
  "conversation.saveAssistantResponse": typeof conversation.saveAssistantResponse;
  "conversation.getPendingAssistantResponse": typeof conversation.getPendingAssistantResponse;
  "conversation.closeTurnSession": typeof conversation.closeTurnSession;
  "conversation.closeExpiredSessions": typeof conversation.closeExpiredSessions;
  "conversation.markTurnDelivered": typeof conversation.markTurnDelivered;
  "conversation.markTurnFailed": typeof conversation.markTurnFailed;
  "diagnosis.deleteAccountData": typeof diagnosis.deleteAccountDiagnosisData;
  "diagnosis.deferQuestion": typeof diagnosis.deferDiagnosisQuestion;
  "diagnosis.saveAnswer": typeof diagnosis.saveDiagnosisAnswer;
  "diagnosis.findAnswers": typeof diagnosis.findDiagnosisAnswers;
  "diagnosis.listVisible": typeof diagnosis.listVisibleDiagnoses;
  "diagnosisProjection.processRequest": typeof diagnosisBrainProjection.processDiagnosisBrainProjectionRequest;
  "diagnosisProjection.processLatest": typeof diagnosisBrainProjection.processLatestDiagnosisBrainProjection;
  "diagnosisProjection.processPending": typeof diagnosisBrainProjection.processPendingDiagnosisBrainProjections;
};

export type AccountDataOperation = keyof AccountDataActions;
export type AccountDataArgs<TOperation extends AccountDataOperation> = WithoutDatabase<
  AccountDataActions[TOperation]
>;
export type AccountDataResult<TOperation extends AccountDataOperation> = ActionResult<
  AccountDataActions[TOperation]
>;

/** raw SQLiteを公開せず、Accountに固定したdomain operationだけを受け付けるRPC境界。 */
export interface AccountDataRpc {
  execute<TOperation extends AccountDataOperation>(
    accountId: string,
    operation: TOperation,
    ...args: AccountDataArgs<TOperation>
  ): Promise<AccountDataResult<TOperation>>;
}

export interface AccountDataNamespace {
  getByName(name: string): AccountDataRpc;
}

export function accountDataFor(namespace: AccountDataNamespace, accountId: string) {
  const object = namespace.getByName(accountId);
  return {
    execute<TOperation extends AccountDataOperation>(
      operation: TOperation,
      ...args: AccountDataArgs<TOperation>
    ): Promise<AccountDataResult<TOperation>> {
      return object.execute(accountId, operation, ...args);
    },
  };
}
