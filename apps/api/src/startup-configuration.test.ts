import { logger } from "@me-builder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logLineStartupConfiguration } from "./startup-configuration";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logLineStartupConfiguration", () => {
  it("LINE_CHANNEL_ACCESS_TOKEN未設定を起動時の構造化errorログへ記録する", () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    logLineStartupConfiguration({ lineChannelAccessToken: undefined });

    expect(errorLog).toHaveBeenCalledWith(
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
      expect.stringContaining("LINE_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED"),
    );
  });

  it("LINE_CHANNEL_ACCESS_TOKEN設定済みならエラーログを出さない", () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    logLineStartupConfiguration({ lineChannelAccessToken: "configured-token" });

    expect(errorLog).not.toHaveBeenCalled();
  });
});
