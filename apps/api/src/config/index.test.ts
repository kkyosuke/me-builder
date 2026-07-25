import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { ConfigSchema, buildConfig, getCloudflareEnv, getConfig, getLocalEnv } from "./index";

describe("getConfig & ConfigSchema", () => {
  it("Valibot スキーマでデフォルト値が正しく補完されること", () => {
    const parsed = v.parse(ConfigSchema, {});
    expect(parsed.port).toBe(3000);
    expect(parsed.environment).toBe("development");
    expect(parsed.lineWebhookUrl).toBeUndefined();
  });

  it("getLocalEnv がローカル環境変数の生の値を回収すること", () => {
    const rawEnv = getLocalEnv({
      PORT: "3001",
      ENVIRONMENT: "local",
    });
    expect(rawEnv.PORT).toBe("3001");
    expect(rawEnv.ENVIRONMENT).toBe("local");

    const conf = buildConfig(rawEnv);
    expect(conf.port).toBe(3001);
    expect(conf.environment).toBe("local");
  });

  it("getCloudflareEnv が Workers の Bindings から生の値を回収すること", () => {
    const rawEnv = getCloudflareEnv({
      ENVIRONMENT: "preview",
      BASE_DOMAIN: "stg.kagami.kyosuke.dev",
      LINE_CHANNEL_ACCESS_TOKEN: "preview-token",
    });
    expect(rawEnv.ENVIRONMENT).toBe("preview");
    expect(rawEnv.BASE_DOMAIN).toBe("stg.kagami.kyosuke.dev");

    const conf = buildConfig(rawEnv);
    expect(conf.environment).toBe("preview");
    expect(conf.baseDomain).toBe("stg.kagami.kyosuke.dev");
    expect(conf.baseUrl).toBe("https://api.stg.kagami.kyosuke.dev");
    expect(conf.lineWebhookUrl).toBe("https://api.stg.kagami.kyosuke.dev/api/line/webhook");
    expect(conf.lineChannelAccessToken).toBe("preview-token");
  });

  it("指定された env マップから値を取得・解析すること", () => {
    const conf = getConfig({
      PORT: undefined,
      ENVIRONMENT: "development",
      BASE_URL: undefined,
      BASE_DOMAIN: undefined,
      LINE_WEBHOOK_URL: undefined,
    });
    expect(conf.port).toBe(3000);
    expect(conf.environment).toBe("development");
    expect(conf.lineWebhookUrl).toBeUndefined();
  });

  it("BASE_DOMAIN から BASE_URL および LINE_WEBHOOK_URL が自動補完されること", () => {
    const conf = getConfig({
      BASE_DOMAIN: "stg.kagami.kyosuke.dev",
      BASE_URL: undefined,
    });

    expect(conf.baseDomain).toBe("stg.kagami.kyosuke.dev");
    expect(conf.baseUrl).toBe("https://api.stg.kagami.kyosuke.dev");
    expect(conf.lineWebhookUrl).toBe("https://api.stg.kagami.kyosuke.dev/api/line/webhook");
  });

  it("引数からの環境変数を優先して読み込むこと", () => {
    const conf = getConfig({
      PORT: "8080",
      ENVIRONMENT: "production",
      LINE_CHANNEL_ACCESS_TOKEN: "my-token",
      BASE_URL: "https://example.com",
    });

    expect(conf.port).toBe(8080);
    expect(conf.environment).toBe("production");
    expect(conf.lineChannelAccessToken).toBe("my-token");
    expect(conf.baseUrl).toBe("https://example.com");
    expect(conf.lineWebhookUrl).toBe("https://example.com/api/line/webhook");
  });

  it("LINE_WEBHOOK_URL が明示されている場合は BASE_URL より優先されること", () => {
    const conf = getConfig({
      BASE_URL: "https://example.com",
      LINE_WEBHOOK_URL: "https://custom.com/webhook",
    });

    expect(conf.lineWebhookUrl).toBe("https://custom.com/webhook");
  });
});
