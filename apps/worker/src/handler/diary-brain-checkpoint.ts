import { D1, accountDataFor } from "@me-builder/lib";
import type { DiaryBrainCategory } from "@me-builder/lib";
import type {
  DiaryBrainCheckpointQueueMessage,
  Message,
  OperationalOutcome,
} from "@me-builder/shared";
import {
  OperationalError,
  describeQueueMessageResult,
  logger,
  operationalLogLevel,
} from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { createGeminiUsageRecorder } from "../infrastructure/gemini-usage";
import { createLineRetryKey, pushLineTextWithRetryKey } from "../infrastructure/line-delivery";
import { consolidateDiaryBrainCandidates, decideDiaryBrainDuplicates } from "../logic/brain-dedup";
import {
  buildDevelopmentBrainItemMessage,
  generateDiaryBrainCandidates,
} from "../logic/diary-brain";
import { DIARY_BRAIN_PROMPT_VERSION } from "../prompt/diary-brain";

/** wrangler.tomlのmax_retries=5に初回配送を加えた最大試行回数。 */
export const DIARY_BRAIN_CHECKPOINT_MAX_ATTEMPTS = 6;

/** ack時の終端ログ。失敗はQueue dispatch境界がretry判断とともに1件記録する。 */
function logCompleted(
  message: Message<DiaryBrainCheckpointQueueMessage>,
  workerConfig: WorkerConfig,
  startedAt: number,
  details: { outcome: OperationalOutcome; stage: string; resultCode?: string },
): void {
  const durationMs = Date.now() - startedAt;
  const fields = {
    event: "queue.message.completed",
    service: "worker",
    environment: workerConfig.environment,
    component: "diary-brain-checkpoint",
    queueMessageId: message.id,
    messageType: "diary-brain-checkpoint",
    attempt: message.attempts,
    outcome: details.outcome,
    disposition: "ack" as const,
    stage: details.stage,
    ...(details.resultCode ? { resultCode: details.resultCode } : {}),
    durationMs,
  };
  const description = describeQueueMessageResult({
    flow: "diary-brain-checkpoint",
    outcome: details.outcome,
    disposition: "ack",
    stage: details.stage,
    attempt: message.attempts,
    maxAttempts: DIARY_BRAIN_CHECKPOINT_MAX_ATTEMPTS,
    durationMs,
    resultCode: details.resultCode,
  });
  if (operationalLogLevel(details.outcome) === "info") logger.info(fields, description);
  else logger.warn(fields, description);
}

export async function processDiaryBrainCheckpointMessage(
  message: Message<DiaryBrainCheckpointQueueMessage>,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
): Promise<void> {
  const startedAt = Date.now();
  if (!cf.do.accountData) {
    throw new OperationalError({
      code: "ACCOUNT_DATA_BINDING_MISSING",
      category: "configuration",
      stage: "checkpoint.load",
      retryable: true,
      dependency: "account-data",
    });
  }
  const accountData = accountDataFor(cf.do.accountData, message.body.accountId);
  const context = await accountData.execute(
    "conversation.getDiaryBrainCheckpointContext",
    message.body.checkpointId,
  );
  if (!context) {
    await sendDevelopmentNotification(
      accountData,
      message.body.accountId,
      message.body.checkpointId,
      cf,
      workerConfig,
    );
    message.ack();
    logCompleted(message, workerConfig, startedAt, {
      outcome: "discarded",
      stage: "checkpoint.load",
      resultCode: "DIARY_BRAIN_CHECKPOINT_NOT_PENDING",
    });
    return;
  }
  const usageRecorder = createGeminiUsageRecorder(cf.d1, "diary_brain", message.body.accountId);
  const candidates = await generateDiaryBrainCandidates(
    context.messages,
    context.sourceMessageIds,
    workerConfig,
    usageRecorder,
  );
  if (!candidates) {
    throw new OperationalError({
      code: "DIARY_BRAIN_CANDIDATE_GENERATION_FAILED",
      category: "dependency",
      stage: "ai.generate",
      retryable: true,
      dependency: "google-ai",
    });
  }
  const deduplication = await decideDiaryBrainDuplicates({
    candidates: candidates.map((candidate) => ({
      category: candidate.category,
      statement: candidate.statement,
      sourceMessageIds: candidate.source_message_ids,
      ...(candidate.prompt_context ? { promptContext: candidate.prompt_context } : {}),
    })),
    messages: context.messages,
    accountId: message.body.accountId,
    cf,
    workerConfig,
    onUsage: usageRecorder,
  });
  if (!deduplication) {
    throw new OperationalError({
      code: "DIARY_BRAIN_DEDUPLICATION_FAILED",
      category: "dependency",
      stage: "deduplication.decide",
      retryable: true,
      dependency: "google-ai",
    });
  }
  const consolidatedCandidates = consolidateDiaryBrainCandidates(
    candidates.map((candidate) => ({
      category: candidate.category,
      statement: candidate.statement,
      sourceMessageIds: candidate.source_message_ids,
      ...(candidate.prompt_context ? { promptContext: candidate.prompt_context } : {}),
    })),
    deduplication,
  );
  const applied = await accountData.execute(
    "conversation.applyDiaryBrainCheckpoint",
    context.checkpointId,
    context.throughSequence,
    DIARY_BRAIN_PROMPT_VERSION,
    consolidatedCandidates.map((candidate) => ({
      category: candidate.category,
      statement: candidate.statement,
      sourceMessageIds: candidate.sourceMessageIds,
      ...(candidate.promptContext ? { promptContext: candidate.promptContext } : {}),
      evidenceStatements: candidate.evidenceStatements,
      ...(candidate.deduplication !== "none"
        ? {
            ...(candidate.matchingBrainItemId
              ? { matchingBrainItemId: candidate.matchingBrainItemId }
              : {}),
            deduplication: candidate.deduplication,
            ...(candidate.dedupPromptVersion
              ? { dedupPromptVersion: candidate.dedupPromptVersion }
              : {}),
          }
        : {}),
    })),
  );
  if (!applied) {
    message.ack();
    logCompleted(message, workerConfig, startedAt, {
      outcome: "discarded",
      stage: "checkpoint.apply",
      resultCode: "DIARY_BRAIN_CHECKPOINT_SUPERSEDED",
    });
    return;
  }

  await sendDevelopmentNotification(
    accountData,
    message.body.accountId,
    context.checkpointId,
    cf,
    workerConfig,
    applied,
  );
  message.ack();
  logCompleted(message, workerConfig, startedAt, {
    outcome: "succeeded",
    stage: "checkpoint.apply",
  });
}

async function sendDevelopmentNotification(
  accountData: ReturnType<typeof accountDataFor>,
  accountId: string,
  checkpointId: string,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
  appliedResult?: {
    candidates: readonly {
      category: DiaryBrainCategory;
      statement: string;
      sourceMessageIds: readonly string[];
      operation: "created" | "evidence_added";
      deduplication: "none" | "exact" | "semantic";
    }[];
  },
): Promise<void> {
  const result =
    appliedResult ??
    (await accountData.execute(
      "conversation.getDiaryBrainCheckpointDevelopmentNotification",
      checkpointId,
    ));
  if (!result) return;
  const developmentMessage = buildDevelopmentBrainItemMessage(
    result.candidates,
    workerConfig.environment,
  );
  if (
    developmentMessage &&
    workerConfig.lineChannelAccessToken &&
    workerConfig.chatDeliverySecret
  ) {
    const providerAccountId = await D1.shared.action.account.findLineIdentityByAccountId(
      cf.d1,
      accountId,
    );
    if (providerAccountId) {
      await pushLineTextWithRetryKey({
        channelAccessToken: workerConfig.lineChannelAccessToken,
        to: providerAccountId,
        texts: [developmentMessage],
        retryKey: await createLineRetryKey(
          workerConfig.chatDeliverySecret,
          `diary-brain:${checkpointId}`,
        ),
      });
      await accountData.execute(
        "conversation.markDiaryBrainCheckpointDevelopmentNotificationSent",
        checkpointId,
      );
    }
  }
}
