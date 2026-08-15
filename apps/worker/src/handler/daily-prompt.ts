import { D1, accountDataFor } from "@me-builder/lib";
import type { DailyPromptQueueMessage, Message, OperationalOutcome } from "@me-builder/shared";
import {
  OperationalError,
  describeQueueMessageResult,
  logger,
  operationalLogLevel,
  toOperationalError,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import {
  createLineRetryKey,
  getLineDeliveryFailureKind,
  pushLineTextWithRetryKey,
} from "../infrastructure/line-delivery";
import {
  getDailyPromptContextCutoffAt,
  getDailyPromptText,
  getDailyPromptVersion,
  getDailyPromptWeekday,
} from "../prompt/daily-prompt";

/** wrangler.tomlのmax_retries=5に初回配送を加えた最大試行回数。 */
export const DAILY_PROMPT_MAX_ATTEMPTS = 6;

export async function processDailyPromptMessage(
  message: Message<DailyPromptQueueMessage>,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
): Promise<void> {
  const startedAt = Date.now();
  const accountDataNamespace = cf.do.accountData;
  if (!accountDataNamespace) {
    throw configurationError("ACCOUNT_DATA_BINDING_MISSING", "daily-prompt.prepare");
  }
  const accountData = accountDataFor(accountDataNamespace, message.body.accountId);
  let deliveryId: string | undefined;

  try {
    const contextCutoffAt = getDailyPromptContextCutoffAt(message.body.localDate);
    const weekdayContext = await accountData
      .execute(
        "brain.selectDailyPromptWeekdayContext",
        getDailyPromptWeekday(message.body.localDate),
      )
      .catch((error: unknown) => {
        logger.warn(
          {
            event: "daily-prompt.weekday-context.failed",
            service: "worker",
            environment: workerConfig.environment,
            component: "daily-prompt",
            queueMessageId: message.id,
            localDate: message.body.localDate,
            attempt: message.attempts,
            outcome: "degraded",
            disposition: "continue",
            ...toSafeOperationalErrorFields(error, {
              code: "DAILY_PROMPT_WEEKDAY_CONTEXT_LOAD_FAILED",
              category: "dependency",
              stage: "daily-prompt.context",
              retryable: false,
              dependency: "account-data",
            }),
          },
          "[Daily prompt] failed at daily-prompt.context -> continue without newly selected weekday context",
        );
        return undefined;
      });
    const sameDayContext = await accountData
      .execute(
        "conversation.selectDailyPromptSameDayContext",
        message.body.localDate,
        contextCutoffAt,
      )
      .catch((error: unknown) => {
        logger.warn(
          {
            event: "daily-prompt.same-day-context.failed",
            service: "worker",
            environment: workerConfig.environment,
            component: "daily-prompt",
            queueMessageId: message.id,
            localDate: message.body.localDate,
            attempt: message.attempts,
            outcome: "degraded",
            disposition: "continue",
            ...toSafeOperationalErrorFields(error, {
              code: "DAILY_PROMPT_SAME_DAY_CONTEXT_LOAD_FAILED",
              category: "dependency",
              stage: "daily-prompt.context",
              retryable: false,
              dependency: "account-data",
            }),
          },
          "[Daily prompt] failed to load same-day context -> continue without it",
        );
        return undefined;
      });
    const previousDayContext =
      sameDayContext || weekdayContext
        ? undefined
        : await accountData
            .execute("conversation.selectDailyPromptPreviousDayContext", message.body.localDate)
            .catch((error: unknown) => {
              logger.warn(
                {
                  event: "daily-prompt.previous-day-context.failed",
                  service: "worker",
                  environment: workerConfig.environment,
                  component: "daily-prompt",
                  queueMessageId: message.id,
                  localDate: message.body.localDate,
                  attempt: message.attempts,
                  outcome: "degraded",
                  disposition: "continue",
                  ...toSafeOperationalErrorFields(error, {
                    code: "DAILY_PROMPT_PREVIOUS_DAY_CONTEXT_LOAD_FAILED",
                    category: "dependency",
                    stage: "daily-prompt.context",
                    retryable: false,
                    dependency: "account-data",
                  }),
                },
                "[Daily prompt] failed to load previous-day context -> continue without it",
              );
              return undefined;
            });
    const promptStrategy = await accountData
      .execute("brain.selectDailyPromptStrategyPreference")
      .catch((error: unknown) => {
        logger.warn(
          {
            event: "daily-prompt.strategy-preference.failed",
            service: "worker",
            environment: workerConfig.environment,
            component: "daily-prompt",
            queueMessageId: message.id,
            localDate: message.body.localDate,
            attempt: message.attempts,
            outcome: "degraded",
            disposition: "continue",
            ...toSafeOperationalErrorFields(error, {
              code: "DAILY_PROMPT_STRATEGY_PREFERENCE_LOAD_FAILED",
              category: "dependency",
              stage: "daily-prompt.strategy",
              retryable: false,
              dependency: "account-data",
            }),
          },
          "[Daily prompt] failed to load strategy preference -> continue with standard strategy",
        );
        return undefined;
      });
    const learnedPromptStrategy = promptStrategy
      ? undefined
      : await accountData.execute("conversation.selectDailyPromptStrategy").catch((error) => {
          logger.warn(
            {
              event: "daily-prompt.strategy-selection.failed",
              service: "worker",
              environment: workerConfig.environment,
              component: "daily-prompt",
              queueMessageId: message.id,
              localDate: message.body.localDate,
              attempt: message.attempts,
              outcome: "degraded",
              disposition: "continue",
              ...toSafeOperationalErrorFields(error, {
                code: "DAILY_PROMPT_STRATEGY_SELECTION_FAILED",
                category: "dependency",
                stage: "daily-prompt.strategy",
                retryable: false,
                dependency: "account-data",
              }),
            },
            "[Daily prompt] failed to select learned strategy -> continue with standard strategy",
          );
          return undefined;
        });
    const selectedPromptStrategy = promptStrategy ?? learnedPromptStrategy ?? "standard";
    const promptVersion = getDailyPromptVersion(
      message.body.localDate,
      weekdayContext,
      sameDayContext,
      previousDayContext,
      selectedPromptStrategy,
    );
    const preparation = await accountData.execute("conversation.prepareDailyPrompt", {
      localDate: message.body.localDate,
      promptVersion,
      promptStrategy: selectedPromptStrategy,
    });
    if (preparation.type === "not-ready") {
      message.ack();
      logResult(message, workerConfig, startedAt, {
        outcome: "succeeded",
        disposition: "ack",
        stage: "daily-prompt.skip",
        resultCode:
          preparation.status === "skipped"
            ? `DAILY_PROMPT_${preparation.reason?.toUpperCase() ?? "SKIPPED"}`
            : `DAILY_PROMPT_ALREADY_${preparation.status.toUpperCase()}`,
      });
      return;
    }
    deliveryId = preparation.deliveryId;

    const lineIdentity = await D1.shared.action.account.findLineIdentityByAccountId(
      cf.d1,
      message.body.accountId,
    );
    if (!lineIdentity) {
      await accountData.execute(
        "conversation.markDailyPromptFailed",
        deliveryId,
        "line-identity.resolve",
      );
      message.ack();
      logResult(message, workerConfig, startedAt, {
        outcome: "discarded",
        disposition: "ack",
        stage: "line-identity.resolve",
        resultCode: "DAILY_PROMPT_LINE_IDENTITY_MISSING",
      });
      return;
    }
    if (!workerConfig.lineChannelAccessToken) {
      throw configurationError("LINE_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED", "line.push");
    }
    if (!workerConfig.chatDeliverySecret) {
      throw configurationError("CHAT_DELIVERY_SECRET_NOT_CONFIGURED", "line.retry-key");
    }
    const retryKey = await createLineRetryKey(
      workerConfig.chatDeliverySecret,
      `${message.body.accountId}:${deliveryId}`,
    );
    try {
      await pushLineTextWithRetryKey({
        channelAccessToken: workerConfig.lineChannelAccessToken,
        to: lineIdentity,
        texts: [getDailyPromptText(preparation.promptVersion)],
        retryKey,
      });
    } catch (error) {
      if (getLineDeliveryFailureKind(error) === "permanent") {
        await accountData.execute("conversation.markDailyPromptFailed", deliveryId, "line.push");
        message.ack();
        logResult(message, workerConfig, startedAt, {
          outcome: "discarded",
          disposition: "ack",
          stage: "line.push",
          resultCode: "DAILY_PROMPT_LINE_REJECTED",
        });
        return;
      }
      throw new OperationalError({
        code: "DAILY_PROMPT_LINE_PUSH_FAILED",
        category: "dependency",
        stage: "line.push",
        retryable: true,
        dependency: "line",
      });
    }

    const marked = await accountData.execute("conversation.markDailyPromptDelivered", deliveryId);
    if (!marked) {
      throw new OperationalError({
        code: "DAILY_PROMPT_DELIVERY_STATE_REJECTED",
        category: "invariant",
        stage: "daily-prompt.persist",
        retryable: true,
        dependency: "account-data",
      });
    }
    message.ack();
    logResult(message, workerConfig, startedAt, {
      outcome: "succeeded",
      disposition: "ack",
      stage: "daily-prompt.deliver",
    });
  } catch (error) {
    const operationalError = toOperationalError(error, {
      code: "DAILY_PROMPT_PROCESSING_FAILED",
      category: "unknown",
      stage: "daily-prompt.process",
      retryable: true,
    });
    const isFinalAttempt = message.attempts >= DAILY_PROMPT_MAX_ATTEMPTS;
    if (!operationalError.retryable && deliveryId) {
      await accountData.execute(
        "conversation.markDailyPromptFailed",
        deliveryId,
        operationalError.stage,
      );
    }
    if (operationalError.retryable) message.retry();
    else message.ack();
    logResult(message, workerConfig, startedAt, {
      outcome: "failed",
      disposition: operationalError.retryable ? (isFinalAttempt ? "dead-letter" : "retry") : "ack",
      stage: operationalError.stage,
      error: operationalError,
    });
  }
}

function configurationError(code: string, stage: string): OperationalError {
  return new OperationalError({ code, category: "configuration", stage, retryable: false });
}

function logResult(
  message: Message<DailyPromptQueueMessage>,
  workerConfig: WorkerConfig,
  startedAt: number,
  details: Readonly<{
    outcome: Extract<OperationalOutcome, "succeeded" | "discarded" | "failed">;
    disposition: "ack" | "retry" | "dead-letter";
    stage: string;
    resultCode?: string;
    error?: unknown;
  }>,
): void {
  const durationMs = Date.now() - startedAt;
  const safeError = details.error
    ? toSafeOperationalErrorFields(details.error, {
        code: "DAILY_PROMPT_PROCESSING_FAILED",
        category: "unknown",
        stage: details.stage,
        retryable: true,
      })
    : undefined;
  const fields = {
    event: details.outcome === "failed" ? "queue.message.failed" : "queue.message.completed",
    service: "worker",
    environment: workerConfig.environment,
    component: "daily-prompt",
    queueMessageId: message.id,
    messageType: "daily-prompt",
    localDate: message.body.localDate,
    attempt: message.attempts,
    outcome: details.outcome,
    disposition: details.disposition,
    stage: details.stage,
    ...(details.resultCode ? { resultCode: details.resultCode } : {}),
    ...(safeError ?? {}),
    durationMs,
  };
  const description = describeQueueMessageResult({
    flow: "daily-prompt",
    outcome: details.outcome,
    disposition: details.disposition,
    stage: details.stage,
    attempt: message.attempts,
    maxAttempts: DAILY_PROMPT_MAX_ATTEMPTS,
    durationMs,
    resultCode: details.resultCode,
    error: safeError,
  });
  logger[operationalLogLevel(details.outcome, Boolean(safeError))](fields, description);
}
