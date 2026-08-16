import type {
  ActivateCompatibilityReferenceResult,
  CompatibilityReference,
  CompatibilityReferenceRole,
  ReleaseCompatibilityReservationResult,
  ReserveCompatibilityReferenceResult,
} from "../../compatibility-data";
import type {
  CompatibilityShareProfileReadResult,
  CompleteProfileSummaryGenerationInput,
  ProfileSummaryGenerationContext,
  ProfileSummaryReadModel,
  RequestProfileSummaryGenerationResult,
} from "../../profile-summary";
import type * as aiUsage from "./action/ai-usage";
import type * as brain from "./action/brain";
import type * as development from "./action/development";
import type * as diagnosis from "./action/diagnosis";
import type * as diagnosisBrainProjection from "./action/diagnosis-brain-projection";
import type * as diary from "./action/diary";
import type * as personalDataExport from "./action/personal-data-export";
import type * as profileSummary from "./action/profile-summary";
import type * as progression from "./action/progression";
import type * as source from "./action/source";

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
  "aiUsage.reserve": RpcAction<
    [input: aiUsage.ReserveAiUsageInput, at?: Date],
    typeof aiUsage.reserveAiUsage
  >;
  "aiUsage.commit": RpcAction<[requestId: string, at?: Date], typeof aiUsage.commitAiUsage>;
  "aiUsage.release": RpcAction<[requestId: string, at?: Date], typeof aiUsage.releaseAiUsage>;
  "aiUsage.read": RpcAction<
    [kind: aiUsage.AiUsageKind, period: aiUsage.AiUsagePeriod, limit: number, at?: Date],
    typeof aiUsage.readAiUsage
  >;
  "brain.listActive": RpcAction<[], typeof brain.listActiveBrainItems>;
  "brain.findActiveVectorEntry": RpcAction<
    [brainItemId: string],
    typeof brain.findActiveBrainVectorEntry
  >;
  "brain.loadChatContextMemories": RpcAction<
    [vectorIds: readonly string[], at?: Date, notBefore?: Date],
    typeof brain.loadBrainChatContextMemories
  >;
  "brain.listActivePromptContextKinds": RpcAction<
    [at?: Date],
    typeof brain.listActivePromptContextKinds
  >;
  "brain.selectDailyPromptWeekdayContext": RpcAction<
    [weekday: Parameters<typeof brain.selectDailyPromptWeekdayContext>[2], at?: Date],
    typeof brain.selectDailyPromptWeekdayContext
  >;
  "brain.selectDailyPromptStrategyPreference": RpcAction<
    [at?: Date],
    typeof brain.selectDailyPromptStrategyPreference
  >;
  "brain.selectDailyPromptTimePreference": RpcAction<
    [at?: Date],
    typeof brain.selectDailyPromptTimePreference
  >;
  "brain.loadSemanticDedupCandidates": RpcAction<
    [vectorIds: readonly string[], categories: readonly string[]],
    typeof brain.loadBrainSemanticDedupCandidates
  >;
  "brain.getVectorSyncTarget": RpcAction<
    [jobId: string, brainItemId: string, itemRevision: number],
    typeof brain.getBrainVectorSyncTarget
  >;
  "brain.completeVectorSyncJob": RpcAction<
    [jobId: string, applied: brain.AppliedBrainVectorSync, mutationId: string, at?: Date],
    typeof brain.completeBrainVectorSyncJob
  >;
  "brain.failVectorSyncJob": RpcAction<
    [jobId: string, failureCode: string, retryable?: boolean, at?: Date],
    typeof brain.failBrainVectorSyncJob
  >;
  "brain.listFailedVectorSyncJobs": RpcAction<[], typeof brain.listFailedBrainVectorSyncJobs>;
  "brain.resetFailedVectorSyncJob": RpcAction<
    [jobId: string, at?: Date],
    typeof brain.resetFailedBrainVectorSyncJob
  >;
  "brain.resetAllFailedVectorSyncJobs": RpcAction<
    [at?: Date],
    typeof brain.resetAllFailedBrainVectorSyncJobs
  >;
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
  "source.hasActive": RpcAction<[], typeof source.hasActiveSourceRecords>;
  "source.listPersonalData": RpcAction<[], typeof source.listPersonalDataRecords>;
  "source.correctPersonalData": RpcAction<
    [sourceRecordId: string, input: source.CorrectPersonalDataRecordInput, at?: Date],
    typeof source.correctPersonalDataRecord
  >;
  "source.deletePersonalData": RpcAction<
    [sourceRecordId: string, at?: Date],
    typeof source.deletePersonalDataRecord
  >;
  "personalDataExport.request": RpcAction<
    [at?: Date],
    typeof personalDataExport.requestPersonalDataExport
  >;
  "personalDataExport.readStatus": RpcAction<
    [exportId: string, at?: Date],
    typeof personalDataExport.readPersonalDataExportStatus
  >;
  "personalDataExport.readArchive": RpcAction<
    [exportId: string, at?: Date],
    typeof personalDataExport.readPersonalDataArchive
  >;
  "profileSummary.read": (
    at?: Date,
    allowUnchangedRegeneration?: boolean,
  ) => Promise<ProfileSummaryReadModel>;
  "profileSummary.readCompatibilityShareProfile": () => Promise<CompatibilityShareProfileReadResult>;
  "profileSummary.requestGeneration": (
    requestedAt?: Date,
    allowUnchangedRegeneration?: boolean,
  ) => Promise<RequestProfileSummaryGenerationResult>;
  "profileSummary.listUndispatchedGenerationIds": (at?: Date, limit?: number) => Promise<string[]>;
  "profileSummary.markGenerationDispatched": (
    generationId: string,
    dispatchedAt?: Date,
  ) => Promise<boolean>;
  "profileSummary.loadGenerationContext": (
    generationId: string,
    startedAt?: Date,
  ) => Promise<ProfileSummaryGenerationContext | null>;
  "profileSummary.readGenerationStatus": RpcAction<
    [generationId: string],
    typeof profileSummary.readProfileSummaryGenerationStatus
  >;
  "profileSummary.completeGeneration": (
    input: CompleteProfileSummaryGenerationInput,
  ) => Promise<boolean>;
  "profileSummary.failGeneration": (
    generationId: string,
    message: string,
    failedAt?: Date,
  ) => Promise<void>;
  "progression.read": RpcAction<[at?: Date], typeof progression.readUtsushiProgression>;
  "conversation.storeLineTextSource": RpcAction<
    [WithoutAccountId<Parameters<typeof diary.storeLineTextSource>[1]>],
    typeof diary.storeLineTextSource
  >;
  "conversation.prepareDailyPrompt": RpcAction<
    [input: Parameters<typeof diary.prepareDailyPrompt>[2]],
    typeof diary.prepareDailyPrompt
  >;
  "conversation.resolveDailyPromptSchedule": RpcAction<
    [
      localDate: string,
      selectedLocalHour: Parameters<typeof diary.resolveDailyPromptSchedule>[3],
      selectionSource: Parameters<typeof diary.resolveDailyPromptSchedule>[4],
    ],
    typeof diary.resolveDailyPromptSchedule
  >;
  "conversation.selectDailyPromptSameDayContext": RpcAction<
    [localDate: string, at?: Date],
    typeof diary.selectDailyPromptSameDayContext
  >;
  "conversation.selectDailyPromptPreviousDayContext": RpcAction<
    [localDate: string],
    typeof diary.selectDailyPromptPreviousDayContext
  >;
  "conversation.markDailyPromptDelivered": RpcAction<
    [deliveryId: string, at?: Date],
    typeof diary.markDailyPromptDelivered
  >;
  "conversation.markDailyPromptFailed": RpcAction<
    [deliveryId: string, failureStage: string, at?: Date],
    typeof diary.markDailyPromptFailed
  >;
  "conversation.listDailyPromptStrategyStats": RpcAction<
    [],
    typeof diary.listDailyPromptStrategyStats
  >;
  "conversation.selectDailyPromptStrategy": RpcAction<[], typeof diary.selectDailyPromptStrategy>;
  "conversation.listDailyPromptTimeStats": RpcAction<[], typeof diary.listDailyPromptTimeStats>;
  "conversation.selectDailyPromptLocalHour": RpcAction<[], typeof diary.selectDailyPromptLocalHour>;
  "conversation.attachMessagesToTurn": RpcAction<
    [
      inputs: Parameters<typeof diary.attachMessagesToTurn>[2],
      generationEpoch: number,
      model: string,
      promptVersion: string,
      conversationPolicyIds?: readonly string[],
    ],
    typeof diary.attachMessagesToTurn
  >;
  "conversation.getTurnContext": DomainAction<typeof diary.getTurnContext>;
  "conversation.claimDueDiaryBrainCheckpoints": RpcAction<
    [at?: Date],
    typeof diary.claimDueDiaryBrainCheckpointIds
  >;
  "conversation.resetFailedDiaryBrainCheckpoint": RpcAction<
    [checkpointId: string, at?: Date],
    typeof diary.resetFailedDiaryBrainCheckpoint
  >;
  "conversation.getDiaryBrainCheckpointContext": RpcAction<
    [checkpointId: string],
    typeof diary.getDiaryBrainCheckpointContext
  >;
  "conversation.applyDiaryBrainCheckpoint": RpcAction<
    [
      checkpointId: string,
      expectedThroughSequence: number,
      promptVersion: string,
      candidates: readonly diary.DiaryBrainCheckpointCandidate[],
      at?: Date,
    ],
    typeof diary.applyDiaryBrainCheckpoint
  >;
  "conversation.getDiaryBrainCheckpointDevelopmentNotification": RpcAction<
    [checkpointId: string],
    typeof diary.getDiaryBrainCheckpointDevelopmentNotification
  >;
  "conversation.markDiaryBrainCheckpointDevelopmentNotificationSent": RpcAction<
    [checkpointId: string, at?: Date],
    typeof diary.markDiaryBrainCheckpointDevelopmentNotificationSent
  >;
  "conversation.markTurnGenerating": DomainAction<typeof diary.markTurnGenerating>;
  "conversation.getTurnStatus": DomainAction<typeof diary.getTurnStatus>;
  "conversation.isTurnSessionActive": DomainAction<typeof diary.isTurnSessionActive>;
  "conversation.saveAssistantResponse": RpcAction<
    [input: Parameters<typeof diary.saveAssistantResponse>[2]],
    typeof diary.saveAssistantResponse
  >;
  "conversation.getPendingAssistantResponse": RpcAction<
    [turnId: string],
    typeof diary.getPendingAssistantResponse
  >;
  "conversation.closeTurnSession": DomainAction<typeof diary.closeTurnSession>;
  "conversation.markTurnDelivered": DomainAction<typeof diary.markTurnDelivered>;
  "conversation.markTurnFailed": DomainAction<typeof diary.markTurnFailed>;
  "diagnosis.deleteAccountData": RpcAction<[], typeof diagnosis.deleteAccountDiagnosisData>;
  "development.deleteAllAccountData": RpcAction<
    [resetEpoch: number, at?: Date],
    typeof development.deleteAllDevelopmentAccountData
  >;
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
  "diagnosis.getAnsweredSource": RpcAction<[at: Date], typeof diagnosis.getDiagnosisAnsweredSource>;
  "diagnosis.hasResponse": RpcAction<[diagnosisId: string], typeof diagnosis.hasDiagnosisResponse>;
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
