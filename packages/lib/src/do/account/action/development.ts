import { count, eq } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import {
  accountDataIdentity,
  aiUsageRecords,
  brainItemAccessLabels,
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItemTopicLabels,
  brainItems,
  brainVectorEntries,
  brainVectorSyncJobs,
  chatTurns,
  compatibilityReferences,
  conversationMessages,
  conversationSessions,
  dailyPromptDeliveries,
  dailyPromptPreferences,
  dailyPromptSchedules,
  diagnosisAnswers,
  diagnosisBrainProjectionHeads,
  diagnosisBrainProjectionRequests,
  diagnosisDeferredQuestions,
  diagnosisResponses,
  diaryBrainCheckpointItems,
  diaryBrainCheckpoints,
  diaryChatBrainUsageAudits,
  goalFollowUps,
  monthlyChangeVersions,
  personalDataExports,
  photoDiaryMedia,
  profileSummaryGenerations,
  profileSummaryInsightSelfViews,
  profileSummaryShareProjections,
  profileSummaryVersions,
  progressionEvents,
  progressionItemStates,
  progressionMilestones,
  progressionPendingEvents,
  progressionStates,
  selfCareConfirmations,
  sourceRecordRevisions,
  sourceRecordTextPayloads,
  sourceRecords,
  weeklyReflectionGenerations,
  weeklyReflections,
} from "../schema";

export type DeletedDevelopmentAccountData = Readonly<{
  deletedDiagnosisResponseCount: number;
  deletedConversationSessionCount: number;
  deletedSourceRecordCount: number;
  deletedBrainItemCount: number;
  deletedProfileSummaryVersionCount: number;
  scheduledVectorDeletionCount: number;
}>;

type D1BatchStatement = Parameters<AccountDataDatabase["batch"]>[0][number];

/**
 * AccountDataの個人コンテンツを物理削除する。
 * Account identity、catalog snapshot、Vector削除完了用の行だけを維持する。
 */
export async function deleteAllDevelopmentAccountData(
  db: AccountDataDatabase,
  accountId: string,
  resetEpoch: number,
  at = new Date(),
): Promise<DeletedDevelopmentAccountData> {
  if (!Number.isSafeInteger(resetEpoch) || resetEpoch < 0) {
    throw new Error("AccountData reset epoch must be a non-negative safe integer");
  }
  const identity = await db
    .select({ resetEpoch: accountDataIdentity.resetEpoch })
    .from(accountDataIdentity)
    .where(eq(accountDataIdentity.accountId, accountId))
    .get();
  if (!identity) throw new Error("AccountData identity is missing");
  if (resetEpoch <= identity.resetEpoch) {
    return {
      deletedDiagnosisResponseCount: 0,
      deletedConversationSessionCount: 0,
      deletedSourceRecordCount: 0,
      deletedBrainItemCount: 0,
      deletedProfileSummaryVersionCount: 0,
      scheduledVectorDeletionCount: 0,
    };
  }

  const [
    deletedDiagnosisResponseCount,
    deletedConversationSessionCount,
    deletedSourceRecordCount,
    deletedBrainItemCount,
    deletedProfileSummaryVersionCount,
    itemRows,
    entryRows,
    jobRows,
  ] = await Promise.all([
    db.select({ value: count() }).from(diagnosisResponses).get(),
    db.select({ value: count() }).from(conversationSessions).get(),
    db.select({ value: count() }).from(sourceRecords).get(),
    db.select({ value: count() }).from(brainItems).get(),
    db.select({ value: count() }).from(profileSummaryVersions).get(),
    db.select({ brainItemId: brainItems.id }).from(brainItems),
    db.select({ brainItemId: brainVectorEntries.brainItemId }).from(brainVectorEntries),
    db
      .select({
        brainItemId: brainVectorSyncJobs.brainItemId,
        itemRevision: brainVectorSyncJobs.itemRevision,
      })
      .from(brainVectorSyncJobs),
  ]);
  const vectorBrainItemIds = [
    ...new Set([...itemRows, ...entryRows, ...jobRows].map(({ brainItemId }) => brainItemId)),
  ];
  const latestRevisionByBrainItemId = new Map<string, number>();
  for (const job of jobRows) {
    latestRevisionByBrainItemId.set(
      job.brainItemId,
      Math.max(latestRevisionByBrainItemId.get(job.brainItemId) ?? 0, job.itemRevision),
    );
  }

  const statements: D1BatchStatement[] = [
    db
      .update(accountDataIdentity)
      .set({ resetEpoch })
      .where(eq(accountDataIdentity.accountId, accountId)),
    db.delete(profileSummaryShareProjections),
    db.delete(profileSummaryInsightSelfViews),
    db.delete(profileSummaryVersions),
    db.delete(profileSummaryGenerations),
    db.delete(weeklyReflections),
    db.delete(weeklyReflectionGenerations),
    db.delete(monthlyChangeVersions),
    db.delete(goalFollowUps),
    db.delete(selfCareConfirmations),
    db.delete(personalDataExports),
    db.delete(photoDiaryMedia),
    db.delete(compatibilityReferences),
    db.delete(aiUsageRecords),
    db.delete(progressionPendingEvents),
    db.delete(progressionItemStates),
    db.delete(progressionMilestones),
    db.delete(progressionEvents),
    db.delete(progressionStates),
    db.delete(diagnosisBrainProjectionHeads),
    db.delete(diagnosisBrainProjectionRequests),
    db.delete(diagnosisDeferredQuestions),
    db.delete(diagnosisAnswers),
    db.delete(diagnosisResponses),
    db.delete(diaryBrainCheckpointItems),
    db.delete(diaryChatBrainUsageAudits),
    db.delete(dailyPromptDeliveries),
    db.delete(dailyPromptSchedules),
    db.delete(dailyPromptPreferences),
    db.delete(conversationMessages),
    db.delete(chatTurns),
    db.delete(diaryBrainCheckpoints),
    db.delete(conversationSessions),
    db.delete(brainItemAccessLabels),
    db.delete(brainItemTopicLabels),
    db.delete(brainItemEvidenceEdges),
    db.delete(brainItemRevisions),
    db.delete(sourceRecordRevisions),
    db.delete(sourceRecordTextPayloads),
    db.delete(sourceRecords),
    db.delete(brainItems),
  ];

  for (const brainItemId of vectorBrainItemIds) {
    // 処理中upsertの完了が必ずこのdeleteを補正対象として再起動できるよう、
    // 既存outboxを残し、そのItemの全revisionより新しいrevisionを採番する。
    const revision = Math.max(
      at.getTime(),
      (latestRevisionByBrainItemId.get(brainItemId) ?? 0) + 1,
    );
    statements.push(
      db.insert(brainVectorSyncJobs).values({
        id: `${brainItemId}:${revision}:development-reset-delete`,
        brainItemId,
        itemRevision: revision,
        operation: "delete",
        status: "pending",
        nextAttemptAt: at,
        createdAt: at,
        updatedAt: at,
      }),
    );
  }

  const [firstStatement, ...remainingStatements] = statements;
  if (!firstStatement) throw new Error("AccountData reset statement is missing");
  await db.batch([firstStatement, ...remainingStatements]);

  return {
    deletedDiagnosisResponseCount: deletedDiagnosisResponseCount?.value ?? 0,
    deletedConversationSessionCount: deletedConversationSessionCount?.value ?? 0,
    deletedSourceRecordCount: deletedSourceRecordCount?.value ?? 0,
    deletedBrainItemCount: deletedBrainItemCount?.value ?? 0,
    deletedProfileSummaryVersionCount: deletedProfileSummaryVersionCount?.value ?? 0,
    scheduledVectorDeletionCount: vectorBrainItemIds.length,
  };
}
