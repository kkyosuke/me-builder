import * as v from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT, WorkerConfigSchema, getWorkerConfig } from "./index";

describe("Worker Config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
    expect(config.geminiModel).toBe("gemini-3.5-flash-lite");
    expect(config.chatContextMessageLimit).toBe(DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT);
  });

  it("LIFF_ID を設定すると liffId が取得され、未設定・空文字なら undefined になること", () => {
    // getWorkerConfig は env に無い値を process.env から補うため、
    // 実行環境の LIFF_ID を消さないと「未設定」の検証にならない。
    vi.stubEnv("LIFF_ID", undefined);

    expect(getWorkerConfig({ LIFF_ID: "1234567890-abcdefgh" }).liffId).toBe("1234567890-abcdefgh");
    expect(getWorkerConfig({}).liffId).toBeUndefined();
    expect(getWorkerConfig({ LIFF_ID: "  " }).liffId).toBeUndefined();
  });

  it("Vertex AI Express Modeの設定を取得すること", () => {
    const config = getWorkerConfig({
      GOOGLE_VERTEX_AI_API_KEY: "google-key",
      GEMINI_MODEL: "gemini-test-model",
    });

    expect(config.googleVertexAiApiKey).toBe("google-key");
    expect(config.geminiModel).toBe("gemini-test-model");
  });

  it("日記チャットのContext message件数を環境変数から取得すること", () => {
    expect(getWorkerConfig({ CHAT_CONTEXT_MESSAGE_LIMIT: "12" }).chatContextMessageLimit).toBe(12);
  });

  it("Context message件数が不正なら既定値へ落とし、Worker全体を止めないこと", () => {
    // ここでthrowすると日記以外のqueue処理まで巻き添えで停止してしまう。
    for (const invalid of ["0", "-1", "1.5", "invalid"]) {
      expect(getWorkerConfig({ CHAT_CONTEXT_MESSAGE_LIMIT: invalid }).chatContextMessageLimit).toBe(
        DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
      );
    }
  });
});
