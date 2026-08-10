import { d1 } from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import type { GeminiUsageRecorder } from "./gemini-client";

export function createGeminiUsageRecorder(
  db: d1.Client,
  operation: "diary_chat" | "diary_brain",
  accountId: string,
): GeminiUsageRecorder {
  return async (usage) => {
    try {
      await d1.action.geminiUsage.storeGeminiUsage(db, { ...usage, operation, accountId });
    } catch (error) {
      logger.error(
        {
          event: "gemini.usage.persist.failed",
          service: "worker",
          component: operation,
          model: usage.model,
          outcome: "failed",
          disposition: "continue",
          ...toSafeOperationalErrorFields(error, {
            code: "GEMINI_USAGE_PERSIST_FAILED",
            category: "dependency",
            stage: "usage.persist",
            retryable: false,
            dependency: "d1",
          }),
        },
        "[Gemini usage] failed at usage.persist -> continue",
      );
    }
  };
}
