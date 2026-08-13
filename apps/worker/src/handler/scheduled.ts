import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import { getCloudflareBindings, getWorkerConfig } from "../config";
import { enqueueDailyPrompts, toTokyoLocalDate } from "../job/daily-prompt";
import type { Env } from "../types";

/** 09:00 UTC = 18:00 JSTのCronをDaily Prompt Queueへfan-outする。 */
export async function scheduledHandler(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const startedAt = Date.now();
  const workerConfig = getWorkerConfig(env as unknown as Record<string, unknown>);
  const cf = getCloudflareBindings(env);
  try {
    if (!cf.queue.dailyPrompt) throw new Error("DAILY_PROMPT_QUEUE binding is not configured");
    const enqueuedCount = await enqueueDailyPrompts({
      db: cf.d1,
      queue: cf.queue.dailyPrompt,
      scheduledTime: controller.scheduledTime,
    });
    logger.info(
      {
        event: "daily-prompt.schedule.completed",
        service: "worker",
        environment: workerConfig.environment,
        component: "daily-prompt-scheduler",
        localDate: toTokyoLocalDate(controller.scheduledTime),
        enqueuedCount,
        outcome: "succeeded",
        durationMs: Date.now() - startedAt,
      },
      `[Daily prompt scheduler] enqueued ${enqueuedCount} account(s)`,
    );
  } catch (error) {
    logger.error(
      {
        event: "daily-prompt.schedule.failed",
        service: "worker",
        environment: workerConfig.environment,
        component: "daily-prompt-scheduler",
        outcome: "failed",
        disposition: "platform-retry",
        ...toSafeOperationalErrorFields(error, {
          code: "DAILY_PROMPT_SCHEDULE_FAILED",
          category: "unknown",
          stage: "daily-prompt.enqueue",
          retryable: true,
        }),
        durationMs: Date.now() - startedAt,
      },
      "[Daily prompt scheduler] failed to enqueue accounts",
    );
    throw error;
  }
}
