import { logger } from "@me-builder/shared";
import type { ApiConfig } from "./config";

type LineStartupConfig = Pick<ApiConfig, "lineChannelAccessToken">;

/** 起動を継続できる設定不足を、運用者が検索できる固定分類で記録する。 */
export function logLineStartupConfiguration(config: LineStartupConfig): void {
  if (config.lineChannelAccessToken) return;

  logger.error(
    {
      event: "api.startup.degraded",
      service: "api",
      component: "line",
      outcome: "degraded",
      disposition: "continue",
      errorCode: "LINE_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED",
      errorCategory: "configuration",
      stage: "configuration.validate",
      retryable: false,
      dependency: "line",
    },
    "[API startup] degraded at configuration.validate -> continue (LINE_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED, category:configuration, via:line)",
  );
}
