import { accountDataFor } from "@me-builder/lib";
import type {
  Message,
  OperationalErrorDescriptor,
  OperationalOutcome,
  ProfileSummaryGenerationQueueMessage,
} from "@me-builder/shared";
import {
  OperationalError,
  describeQueueMessageResult,
  logger,
  operationalLogLevel,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { createGeminiUsageRecorder } from "../infrastructure/gemini-usage";
import type {
  CompatibilityShareRejectionRule,
  ProfileSummaryGenerationFailureReason,
} from "../logic/profile-summary";
import { generateProfileSummary } from "../logic/profile-summary";
import { PROFILE_SUMMARY_PROMPT_VERSION } from "../prompt/profile-summary";

/** wrangler.tomlのmax_retries=5に初回配送を加えた最大試行回数。 */
export const PROFILE_SUMMARY_GENERATION_MAX_ATTEMPTS = 6;
const FAILURE_MESSAGE = "新しい版を作成できませんでした。時間をおいて再試行してください。";

/**
 * 生成できなかった理由を、運用ログだけで次の行動を決められるコードへ写します。
 * 設定不足と入力不在は再試行しても同じ結果になるため、Queueの試行を使い切りません。
 */
const GENERATION_FAILURES: Record<
  ProfileSummaryGenerationFailureReason,
  Omit<OperationalErrorDescriptor, "stage">
> = {
  ai_credentials_missing: {
    code: "PROFILE_SUMMARY_AI_CREDENTIALS_MISSING",
    category: "configuration",
    retryable: false,
  },
  evidence_empty: {
    code: "PROFILE_SUMMARY_EVIDENCE_EMPTY",
    category: "invariant",
    retryable: false,
  },
  response_empty: {
    code: "PROFILE_SUMMARY_RESPONSE_EMPTY",
    category: "dependency",
    retryable: true,
    dependency: "google-ai",
  },
  response_truncated: {
    code: "PROFILE_SUMMARY_RESPONSE_TRUNCATED",
    category: "dependency",
    retryable: true,
    dependency: "google-ai",
  },
  response_not_json: {
    code: "PROFILE_SUMMARY_RESPONSE_NOT_JSON",
    category: "dependency",
    retryable: true,
    dependency: "google-ai",
  },
  response_schema_mismatch: {
    code: "PROFILE_SUMMARY_RESPONSE_SCHEMA_MISMATCH",
    category: "dependency",
    retryable: true,
    dependency: "google-ai",
  },
  insight_key_duplicated: {
    code: "PROFILE_SUMMARY_INSIGHT_KEY_DUPLICATED",
    category: "dependency",
    retryable: true,
    dependency: "google-ai",
  },
  insight_evidence_invalid: {
    code: "PROFILE_SUMMARY_INSIGHT_EVIDENCE_INVALID",
    category: "dependency",
    retryable: true,
    dependency: "google-ai",
  },
};

/**
 * 共有専用projectionの縮退を表す結果コードを返します。
 * 共有できる文章が1件も残らなかった状態は、次の生成で作り直せるよう区別して残します。
 */
function compatibilityShareResultCode(
  generated: Extract<Awaited<ReturnType<typeof generateProfileSummary>>, { type: "generated" }>,
): string | undefined {
  if (generated.summary.compatibilityShareStatements.length === 0) {
    return "PROFILE_SUMMARY_SHARE_STATEMENTS_UNAVAILABLE";
  }
  return generated.rejectedShareRules.length === 0
    ? undefined
    : "PROFILE_SUMMARY_SHARE_STATEMENTS_REJECTED";
}

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
    const generated = await generateProfileSummary(
      context,
      workerConfig,
      createGeminiUsageRecorder(cf.d1, "profile_summary", message.body.accountId),
    );
    if (generated.type === "failed") {
      throw new OperationalError({
        ...GENERATION_FAILURES[generated.reason],
        stage: "ai.generate",
      });
    }
    const completed = await accountData.execute("profileSummary.completeGeneration", {
      generationId: context.generationId,
      generatedAt: new Date(),
      model: workerConfig.geminiModel,
      promptVersion: PROFILE_SUMMARY_PROMPT_VERSION,
      headline: generated.summary.headline,
      insights: generated.summary.insights,
      compatibilityShareStatements: generated.summary.compatibilityShareStatements,
      diagnosisCount: context.diagnosisCount,
      diaryCount: context.diaryCount,
      latestRecordedAt: context.latestRecordedAt,
      inputSnapshot: context.inputSnapshot,
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
    const shareResultCode = compatibilityShareResultCode(generated);
    logResult(message, workerConfig, startedAt, {
      // 共有専用文章が欠けた版も保存するため、本人向けの成功と縮退成功を区別する。
      outcome: shareResultCode ? "degraded" : "succeeded",
      disposition: "ack",
      stage: "summary.persist",
      ...(shareResultCode
        ? { resultCode: shareResultCode, rejectedShareRules: generated.rejectedShareRules }
        : {}),
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
    outcome: Extract<OperationalOutcome, "succeeded" | "degraded" | "discarded" | "failed">;
    disposition: "ack" | "retry" | "dead-letter";
    stage: string;
    resultCode?: string;
    rejectedShareRules?: readonly CompatibilityShareRejectionRule[];
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
    ...(details.rejectedShareRules
      ? {
          rejectedShareStatementCount: details.rejectedShareRules.length,
          rejectedShareRules: [...details.rejectedShareRules],
        }
      : {}),
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
  logger[operationalLogLevel(details.outcome)](fields, description);
}
