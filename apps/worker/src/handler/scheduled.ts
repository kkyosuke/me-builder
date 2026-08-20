import { D1 } from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import { getCloudflareBindings, getWorkerConfig } from "../config";
import { cleanupAvatarOrphansFromCloudflare } from "../job/avatar-orphan-cleanup";
import { enqueueDailyPrompts, toTokyoLocalDate, toTokyoLocalHour } from "../job/daily-prompt";
import type { Env } from "../types";

/** 09:00・11:00・12:00 UTCのCronを18・20・21時のDaily Prompt Queueへfan-outする。 */
export async function scheduledHandler(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const startedAt = Date.now();
  const workerConfig = getWorkerConfig(env as unknown as Record<string, unknown>);
  const cf = getCloudflareBindings(env);
  if (toTokyoLocalHour(controller.scheduledTime) === 18) {
    try {
      const deletedCount = await D1.shared.action.developmentAudit.pruneDevelopmentOperationAudits(
        cf.d1,
        new Date(controller.scheduledTime),
      );
      logger.info(
        {
          event: "development.operation-audit.cleanup.completed",
          service: "worker",
          environment: workerConfig.environment,
          component: "development-operation-audit-cleanup",
          outcome: "succeeded",
          deletedCount,
        },
        "[Development operation audit cleanup] completed",
      );
    } catch (error) {
      logger.error(
        {
          event: "development.operation-audit.cleanup.failed",
          service: "worker",
          environment: workerConfig.environment,
          component: "development-operation-audit-cleanup",
          outcome: "failed",
          disposition: "retry-next-schedule",
          ...toSafeOperationalErrorFields(error, {
            code: "DEVELOPMENT_OPERATION_AUDIT_CLEANUP_FAILED",
            category: "dependency",
            stage: "development.operation-audit.cleanup",
            retryable: true,
          }),
        },
        "[Development operation audit cleanup] failed",
      );
    }
  }
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
        localHour: toTokyoLocalHour(controller.scheduledTime),
        enqueuedCount,
        outcome: "succeeded",
        durationMs: Date.now() - startedAt,
      },
      `[Daily prompt scheduler] enqueued ${enqueuedCount} account(s)`,
    );

    if (toTokyoLocalHour(controller.scheduledTime) === 18) {
      try {
        if (!cf.avatarBucket) throw new Error("AVATAR_BUCKET binding is not configured");
        const cleanup = await cleanupAvatarOrphansFromCloudflare({
          db: cf.d1,
          bucket: cf.avatarBucket,
          mode: workerConfig.avatarCleanupMode,
          now: new Date(controller.scheduledTime),
        });
        logger.info(
          {
            event: "profile.avatar.orphan-cleanup.completed",
            service: "worker",
            environment: workerConfig.environment,
            component: "avatar-orphan-cleanup",
            outcome: cleanup.failedCount === 0 ? "succeeded" : "partially-succeeded",
            ...cleanup,
          },
          "[Avatar orphan cleanup] completed",
        );
      } catch (error) {
        logger.error(
          {
            event: "profile.avatar.orphan-cleanup.failed",
            service: "worker",
            environment: workerConfig.environment,
            component: "avatar-orphan-cleanup",
            outcome: "failed",
            disposition: "retry-next-schedule",
            ...toSafeOperationalErrorFields(error, {
              code: "AVATAR_ORPHAN_CLEANUP_FAILED",
              category: "dependency",
              stage: "profile.avatar.orphan-cleanup",
              retryable: true,
            }),
          },
          "[Avatar orphan cleanup] failed",
        );
      }
    }
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
