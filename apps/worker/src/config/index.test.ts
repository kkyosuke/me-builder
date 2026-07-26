import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { WorkerConfigSchema, getWorkerConfig } from "./index";

describe("Worker Config", () => {
  it("WorkerConfigSchema defaults environment to development", () => {
    const parsed = v.parse(WorkerConfigSchema, {});
    expect(parsed.environment).toBe("development");
  });

  it("parses Cloudflare Worker env bindings correctly", () => {
    const cfEnv = {
      ENVIRONMENT: "preview",
      BASE_DOMAIN: "stg.kagami.kyosuke.dev",
      LINE_CHANNEL_ACCESS_TOKEN: "test-token-123",
    };
    const config = getWorkerConfig(cfEnv);
    expect(config.environment).toBe("preview");
    expect(config.baseDomain).toBe("stg.kagami.kyosuke.dev");
    expect(config.baseUrl).toBe("https://worker.stg.kagami.kyosuke.dev");
    expect(config.apiUrl).toBe("https://api.stg.kagami.kyosuke.dev");
    expect(config.lineChannelAccessToken).toBe("test-token-123");
  });

  it("LIFF_ID を設定すると liffId が取得され、未設定・空文字なら undefined になること", () => {
    expect(getWorkerConfig({ LIFF_ID: "1234567890-abcdefgh" }).liffId).toBe("1234567890-abcdefgh");
    expect(getWorkerConfig({}).liffId).toBeUndefined();
    expect(getWorkerConfig({ LIFF_ID: "  " }).liffId).toBeUndefined();
  });
});
