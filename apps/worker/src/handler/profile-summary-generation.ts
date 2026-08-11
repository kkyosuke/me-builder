import { accountDataFor } from "@me-builder/lib";
import type { Message, ProfileSummaryGenerationQueueMessage } from "@me-builder/shared";
import {
  OperationalError,
  describeQueueMessageResult,
  logger,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { PROFILE_SUMMARY_PROMPT_VERSION, generateProfileSummary } from "../logic/profile-summary";

/** wrangler.tomlのmax_retries=5に初回配送を加えた最大試行回数。 */
export const PROFILE_SUMMARY_GENERATION_MAX_ATTEMPTS = 6;
const FAILURE_MESSAGE = "新しい版を作成できませんでした。時間をおいて再試行してください。";

export async function processProfileSummaryGenerationMessage(
  message: Message<ProfileSummaryGenerationQueueMessage>,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
): Promise<void> {
  const startedAt = Date.now();
  const accountDataNamespace = cf.do.accountData;
  if (!accountDataNamespace) {
    throw new OperationalError({
      code: "ACCOUNT_DATA_BINDING_MISSING",
      category: "configuration",
      stage: "summary.context.load",
      retryable: true,
      dependency: "account-data",
    });
  }
  const accountData = accountDataFor(accountDataNamespace, message.body.accountId);
  try {
    const context = await accountData.execute(
      "profileSummary.loadGenerationContext",
      message.body.generationId,
    );
    if (!context) {
      message.ack();
      logResult(message, workerConfig, startedAt, {
        outcome: "discarded",
        disposition: "ack",
        stage: "summary.context.load",
        resultCode: "PROFILE_SUMMARY_GENERATION_NOT_PENDING",
      });
      return;
    }
    const generated = await generateProfileSummary(context, workerConfig);
    if (!generated) {
      throw new OperationalError({
        code: "PROFILE_SUMMARY_GENERATION_INVALID",
        category: "dependency",
        stage: "ai.generate",
        retryable: true,
        dependency: "google-ai",
      });
    }
    const completed = await accountData.execute("profileSummary.completeGeneration", {
      generationId: context.generationId,
      generatedAt: new Date(),
      model: workerConfig.geminiModel,
      promptVersion: PROFILE_SUMMARY_PROMPT_VERSION,
      headline: generated.headline,
      insights: generated.insights,
      diagnosisCount: context.diagnosisCount,
      diaryCount: context.diaryCount,
      latestRecordedAt: context.latestRecordedAt,
    });
    if (!completed) {
      throw new OperationalError({
        code: "PROFILE_SUMMARY_COMPLETION_REJECTED",
        category: "invariant",
        stage: "summary.persist",
        retryable: false,
        dependency: "account-data",
      });
    }
    message.ack();
    logResult(message, workerConfig, startedAt, {
      outcome: "succeeded",
      disposition: "ack",
      stage: "summary.persist",
    });
  } catch (error) {
    const safeError = toSafeOperationalErrorFields(error, {
      code: "PROFILE_SUMMARY_GENERATION_FAILED",
      category: "unknown",
      stage: "summary.generate",
      retryable: true,
    });
    const isFinalAttempt = message.attempts >= PROFILE_SUMMARY_GENERATION_MAX_ATTEMPTS;
    if (isFinalAttempt || !safeError.retryable) {
      await accountData.execute(
        "profileSummary.failGeneration",
        message.body.generationId,
        FAILURE_MESSAGE,
      );
    }
    if (safeError.retryable) message.retry();
    else message.ack();
    logResult(message, workerConfig, startedAt, {
      outcome: "failed",
      disposition: safeError.retryable ? (isFinalAttempt ? "dead-letter" : "retry") : "ack",
      stage: safeError.stage,
      error,
    });
  }
}

function logResult(
  message: Message<ProfileSummaryGenerationQueueMessage>,
  workerConfig: WorkerConfig,
  startedAt: number,
  details: {
    outcome: "succeeded" | "discarded" | "failed";
    disposition: "ack" | "retry" | "dead-letter";
    stage: string;
    resultCode?: string;
    error?: unknown;
  },
): void {
  const durationMs = Date.now() - startedAt;
  const safeError = details.error
    ? toSafeOperationalErrorFields(details.error, {
        code: "PROFILE_SUMMARY_GENERATION_FAILED",
        category: "unknown",
        stage: details.stage,
        retryable: true,
      })
    : undefined;
  const fields = {
    event: details.outcome === "failed" ? "queue.message.failed" : "queue.message.completed",
    service: "worker",
    environment: workerConfig.environment,
    component: "profile-summary-generation",
    queueMessageId: message.id,
    messageType: "profile-summary-generation",
    attempt: message.attempts,
    outcome: details.outcome,
    disposition: details.disposition,
    stage: details.stage,
    ...(details.resultCode ? { resultCode: details.resultCode } : {}),
    ...(safeError ?? {}),
    durationMs,
  };
  const description = describeQueueMessageResult({
    flow: "profile-summary-generation",
    outcome: details.outcome,
    disposition: details.disposition,
    stage: details.stage,
    attempt: message.attempts,
    maxAttempts: PROFILE_SUMMARY_GENERATION_MAX_ATTEMPTS,
    durationMs,
    resultCode: details.resultCode,
    error: safeError,
  });
  if (details.outcome === "failed") logger.error(fields, description);
  else if (details.outcome === "succeeded") logger.info(fields, description);
  else logger.warn(fields, description);
}
