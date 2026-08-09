import type {
  AcquireAvatarTaskResult,
  AvatarCandidateRecord,
  AvatarJobRecord,
  AvatarQueueOperation,
  AvatarState,
  CreateAvatarJobInput,
  CreateAvatarJobResult,
  PendingAvatarEnqueue,
  ResolveAvatarImageResult,
  SelectAvatarCandidateResult,
  StartAvatarGenerationResult,
} from "./avatar";
import type {
  ActivateCompatibilityReferenceResult,
  CompatibilityReference,
  CompatibilityReferenceRole,
  ReleaseCompatibilityReservationResult,
  ReserveCompatibilityReferenceResult,
} from "./compatibility-data";
import type * as brain from "./d1/action/brain";
import type * as conversation from "./d1/action/conversation";
import type * as diagnosis from "./d1/action/diagnosis";
import type * as diagnosisBrainProjection from "./d1/action/diagnosis-brain-projection";
import type * as source from "./d1/action/source";

type ActionResult<T> = T extends (...args: never[]) => infer TResult ? Awaited<TResult> : never;
type WithoutAccountId<T> = T extends { accountId: unknown } ? Omit<T, "accountId"> : never;
type WithoutDatabase<T> = T extends (...args: infer TArgs) => unknown
  ? TArgs extends [unknown, ...infer TRest]
    ? TRest
    : never
  : never;
type RpcAction<TArgs extends unknown[], TAction extends (...args: never[]) => unknown> = (
  ...args: TArgs
) => ReturnType<TAction>;
type DomainAction<TAction extends (...args: never[]) => unknown> = RpcAction<
  WithoutDatabase<TAction>,
  TAction
>;

export type AccountDataActions = {
  "brain.listActive": RpcAction<[], typeof brain.listActiveBrainItems>;
  "compatibility.addOutgoingReference": (
    input: Readonly<{ relationshipId: string; createdAt: Date }>,
  ) => Promise<CompatibilityReference>;
  "compatibility.reserveIncomingReference": (
    input: Readonly<{ relationshipId: string; partnerAccountId: string; createdAt: Date }>,
  ) => Promise<ReserveCompatibilityReferenceResult>;
  "compatibility.reserveOutgoingReference": (
    input: Readonly<{ relationshipId: string; partnerAccountId: string; updatedAt: Date }>,
  ) => Promise<ReserveCompatibilityReferenceResult>;
  "compatibility.releaseReservation": (
    relationshipId: string,
    releasedAt: Date,
  ) => Promise<ReleaseCompatibilityReservationResult>;
  "compatibility.hasReservation": (
    input: Readonly<{
      relationshipId: string;
      partnerAccountId: string;
      role: CompatibilityReferenceRole;
    }>,
  ) => Promise<boolean>;
  "compatibility.activateReference": (
    input: Readonly<{
      relationshipId: string;
      partnerAccountId: string;
      role: CompatibilityReferenceRole;
      updatedAt: Date;
    }>,
  ) => Promise<ActivateCompatibilityReferenceResult>;
  "compatibility.endReference": (
    relationshipId: string,
    endedAt: Date,
  ) => Promise<CompatibilityReference | null>;
  "compatibility.listVisibleReferences": () => Promise<readonly CompatibilityReference[]>;
  "avatar.getState": (at?: Date) => Promise<AvatarState>;
  "avatar.createJob": (input: CreateAvatarJobInput) => Promise<CreateAvatarJobResult>;
  "avatar.failJob": (jobId: string, errorCode: string, at?: Date) => Promise<void>;
  "avatar.markEnqueued": (
    jobId: string,
    operation: AvatarQueueOperation,
    at?: Date,
  ) => Promise<void>;
  "avatar.recordEnqueueFailure": (
    jobId: string,
    operation: AvatarQueueOperation,
    at?: Date,
  ) => Promise<void>;
  "avatar.startGeneration": (jobId: string, at?: Date) => Promise<StartAvatarGenerationResult>;
  "avatar.cancelJob": (jobId: string, at?: Date) => Promise<AvatarJobRecord | null>;
  "avatar.selectCandidate": (
    candidateId: string,
    at?: Date,
  ) => Promise<SelectAvatarCandidateResult>;
  "avatar.deleteCurrent": (at?: Date) => Promise<{ previousObjectKey: string | null }>;
  "avatar.resolveImage": (imageId: string, at?: Date) => Promise<ResolveAvatarImageResult>;
  "avatar.acquireTask": (
    jobId: string,
    operation: AvatarQueueOperation,
    leaseExpiresAt: Date,
    at?: Date,
  ) => Promise<AcquireAvatarTaskResult>;
  "avatar.finishPersonCheck": (
    jobId: string,
    hasPerson: boolean,
    at?: Date,
  ) => Promise<AvatarJobRecord | null>;
  "avatar.addCandidate": (candidate: AvatarCandidateRecord) => Promise<boolean>;
  "avatar.finishGeneration": (
    jobId: string,
    model: string,
    at?: Date,
  ) => Promise<AvatarJobRecord | null>;
  "avatar.releaseTask": (
    jobId: string,
    operation: AvatarQueueOperation,
    terminal: boolean,
    errorCode: string,
    at?: Date,
  ) => Promise<void>;
  "avatar.listPendingEnqueues": (at?: Date) => Promise<PendingAvatarEnqueue[]>;
  "source.hasActive": RpcAction<[], typeof source.hasActiveSourceRecords>;
  "conversation.storeLineTextSource": RpcAction<
    [WithoutAccountId<Parameters<typeof conversation.storeLineTextSource>[1]>],
    typeof conversation.storeLineTextSource
  >;
  "conversation.attachMessagesToTurn": RpcAction<
    [
      inputs: Parameters<typeof conversation.attachMessagesToTurn>[2],
      generationEpoch: number,
      model: string,
      promptVersion: string,
      conversationPolicyIds?: readonly string[],
    ],
    typeof conversation.attachMessagesToTurn
  >;
  "conversation.getTurnContext": DomainAction<typeof conversation.getTurnContext>;
  "conversation.claimDueDiaryBrainCheckpoints": RpcAction<
    [at?: Date],
    typeof conversation.claimDueDiaryBrainCheckpointIds
  >;
  "conversation.getDiaryBrainCheckpointContext": RpcAction<
    [checkpointId: string],
    typeof conversation.getDiaryBrainCheckpointContext
  >;
  "conversation.applyDiaryBrainCheckpoint": RpcAction<
    [
      checkpointId: string,
      expectedThroughSequence: number,
      promptVersion: string,
      candidates: readonly conversation.DiaryBrainCheckpointCandidate[],
      at?: Date,
    ],
    typeof conversation.applyDiaryBrainCheckpoint
  >;
  "conversation.getDiaryBrainCheckpointDevelopmentNotification": RpcAction<
    [checkpointId: string],
    typeof conversation.getDiaryBrainCheckpointDevelopmentNotification
  >;
  "conversation.markDiaryBrainCheckpointDevelopmentNotificationSent": RpcAction<
    [checkpointId: string, at?: Date],
    typeof conversation.markDiaryBrainCheckpointDevelopmentNotificationSent
  >;
  "conversation.markTurnGenerating": DomainAction<typeof conversation.markTurnGenerating>;
  "conversation.getTurnStatus": DomainAction<typeof conversation.getTurnStatus>;
  "conversation.isTurnSessionActive": DomainAction<typeof conversation.isTurnSessionActive>;
  "conversation.saveAssistantResponse": DomainAction<typeof conversation.saveAssistantResponse>;
  "conversation.getPendingAssistantResponse": RpcAction<
    [turnId: string],
    typeof conversation.getPendingAssistantResponse
  >;
  "conversation.closeTurnSession": DomainAction<typeof conversation.closeTurnSession>;
  "conversation.markTurnDelivered": DomainAction<typeof conversation.markTurnDelivered>;
  "conversation.markTurnFailed": DomainAction<typeof conversation.markTurnFailed>;
  "diagnosis.deleteAccountData": RpcAction<[], typeof diagnosis.deleteAccountDiagnosisData>;
  "diagnosis.deferQuestion": RpcAction<
    [WithoutAccountId<Parameters<typeof diagnosis.deferDiagnosisQuestion>[1]>],
    typeof diagnosis.deferDiagnosisQuestion
  >;
  "diagnosis.saveAnswer": RpcAction<
    [WithoutAccountId<Parameters<typeof diagnosis.saveDiagnosisAnswer>[1]>],
    typeof diagnosis.saveDiagnosisAnswer
  >;
  "diagnosis.findAnswers": RpcAction<
    [diagnosisId: string, at: Date],
    typeof diagnosis.findDiagnosisAnswers
  >;
  "diagnosis.listVisible": RpcAction<[at: Date], typeof diagnosis.listVisibleDiagnoses>;
  "diagnosisProjection.processLatest": RpcAction<
    [diagnosisId: string, at?: Date],
    typeof diagnosisBrainProjection.processLatestDiagnosisBrainProjection
  >;
};

export type AccountDataOperation = keyof AccountDataActions;
export type AccountDataArgs<TOperation extends AccountDataOperation> = Parameters<
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
