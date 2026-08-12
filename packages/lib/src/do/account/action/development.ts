import { count } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import {
  brainItemAccessLabels,
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItemTopicLabels,
  brainItems,
  brainVectorEntries,
  brainVectorSyncJobs,
  chatTurns,
  conversationMessages,
  conversationSessions,
  diagnosisAnswers,
  diagnosisBrainProjectionHeads,
  diagnosisBrainProjectionRequests,
  diagnosisDeferredQuestions,
  diagnosisResponses,
  diaryBrainCheckpointItems,
  diaryBrainCheckpoints,
  diaryChatBrainUsageAudits,
  profileSummaryGenerations,
  profileSummaryShareProjections,
  profileSummaryVersions,
  sourceRecordRevisions,
  sourceRecordTextPayloads,
  sourceRecords,
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
 * 開発用に、AccountDataの個人コンテンツを物理削除する。
 * Account identity、catalog snapshot、相性参照、Vector削除完了用の行は維持する。
 */
export async function deleteAllDevelopmentAccountData(
  db: AccountDataDatabase,
  _accountId: string,
  at = new Date(),
): Promise<DeletedDevelopmentAccountData> {
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
    db.select({ brainItemId: brainVectorSyncJobs.brainItemId }).from(brainVectorSyncJobs),
  ]);
  const vectorBrainItemIds = [
    ...new Set([...itemRows, ...entryRows, ...jobRows].map(({ brainItemId }) => brainItemId)),
  ];
  const revision = at.getTime();

  const statements: D1BatchStatement[] = [
    db.delete(profileSummaryShareProjections),
    db.delete(profileSummaryVersions),
    db.delete(profileSummaryGenerations),
    db.delete(diagnosisBrainProjectionHeads),
    db.delete(diagnosisBrainProjectionRequests),
    db.delete(diagnosisDeferredQuestions),
    db.delete(diagnosisAnswers),
    db.delete(diagnosisResponses),
    db.delete(diaryBrainCheckpointItems),
    db.delete(diaryChatBrainUsageAudits),
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
    db.delete(brainVectorSyncJobs),
  ];

  for (const brainItemId of vectorBrainItemIds) {
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
