import { accountDataFor, billing } from "@me-builder/lib";
import type { Message, WeeklyReflectionGenerationQueueMessage } from "@me-builder/shared";
import { OperationalError, logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { createGeminiUsageRecorder } from "../infrastructure/gemini-usage";
import {
  type WeeklyReflectionFailureReason,
  generateWeeklyReflection,
} from "../logic/weekly-reflection";
import { WEEKLY_REFLECTION_PROMPT_VERSION } from "../prompt/weekly-reflection";

export const WEEKLY_REFLECTION_MAX_ATTEMPTS = 6;
const FAILURE_MESSAGE = "今週の振り返りを作成できませんでした。時間をおいて再試行してください。";

const failureCode = (reason: WeeklyReflectionFailureReason): string =>
  `WEEKLY_REFLECTION_${reason.toUpperCase()}`;

export async function processWeeklyReflectionGenerationMessage(
  message: Message<WeeklyReflectionGenerationQueueMessage>,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
): Promise<void> {
  const namespace = cf.do.accountData;
  if (!namespace) {
    throw new OperationalError({
      code: "ACCOUNT_DATA_BINDING_MISSING",
      category: "configuration",
      stage: "weekly-reflection.context.load",
      retryable: true,
      dependency: "account-data",
    });
  }
  const account = accountDataFor(namespace, message.body.accountId);
  try {
    const entitlement = await new billing.EntitlementService(
      cf.planAssignmentProvider ?? new billing.FakeAccountPlanAssignmentProvider(),
    ).resolve(message.body.accountId);
    if (!entitlement.policy.features["weekly-reflection"]) {
      await account.execute(
        "weeklyReflection.failGeneration",
        message.body.generationId,
        "現在のプランでは新しい週次振り返りを作成できません。",
      );
      message.ack();
      return;
    }
    const context = await account.execute(
      "weeklyReflection.loadGenerationContext",
      message.body.generationId,
    );
    if (!context) {
      message.ack();
      return;
    }
    const generated = await generateWeeklyReflection(
      context,
      workerConfig,
      createGeminiUsageRecorder(cf.d1, "weekly_reflection", message.body.accountId),
    );
    if (generated.type === "failed") {
      throw new OperationalError({
        code: failureCode(generated.reason),
        category: generated.reason === "ai_credentials_missing" ? "configuration" : "dependency",
        stage: "weekly-reflection.ai.generate",
        retryable: generated.reason !== "ai_credentials_missing",
        ...(generated.reason === "ai_credentials_missing" ? {} : { dependency: "google-ai" }),
      });
    }
    const completed = await account.execute("weeklyReflection.completeGeneration", {
      generationId: context.generationId,
      generatedAt: new Date(),
      model: workerConfig.geminiModel,
      promptVersion: WEEKLY_REFLECTION_PROMPT_VERSION,
      headline: generated.headline,
      items: generated.items,
      evidenceCount: context.evidence.length,
    });
    if (!completed) {
      throw new OperationalError({
        code: "WEEKLY_REFLECTION_COMPLETION_REJECTED",
        category: "invariant",
        stage: "weekly-reflection.persist",
        retryable: false,
      });
    }
    message.ack();
  } catch (error) {
    const safe = toSafeOperationalErrorFields(error, {
      code: "WEEKLY_REFLECTION_GENERATION_FAILED",
      category: "unknown",
      stage: "weekly-reflection.generate",
      retryable: true,
    });
    const finalAttempt = message.attempts >= WEEKLY_REFLECTION_MAX_ATTEMPTS;
    if (finalAttempt || !safe.retryable) {
      await account.execute(
        "weeklyReflection.failGeneration",
        message.body.generationId,
        FAILURE_MESSAGE,
      );
    }
    if (safe.retryable) message.retry();
    else message.ack();
    logger.error(
      {
        event: "queue.message.failed",
        service: "worker",
        component: "weekly-reflection-generation",
        messageType: "weekly-reflection-generation",
        attempt: message.attempts,
        outcome: "failed",
        disposition: safe.retryable ? (finalAttempt ? "dead-letter" : "retry") : "ack",
        ...safe,
      },
      "[Weekly reflection generation] failed",
    );
  }
}
