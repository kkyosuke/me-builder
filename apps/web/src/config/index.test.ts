import * as v from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebConfigSchema, getWebConfig } from "./index";

describe("getWebConfig & WebConfigSchema", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Valibot スキーマでデフォルト値が正しく補完されること", () => {
    const parsed = v.parse(WebConfigSchema, {});
    expect(parsed.environment).toBe("development");
    expect(parsed.liffId).toBeUndefined();
  });

  it("BASE_DOMAIN から UI URL および API URL が自動補完されること", () => {
    const conf = getWebConfig({
      BASE_DOMAIN: "stg.kagami.kyosuke.dev",
      BASE_URL: undefined,
      API_URL: undefined,
    });

    expect(conf.baseDomain).toBe("stg.kagami.kyosuke.dev");
    expect(conf.baseUrl).toBe("https://stg.kagami.kyosuke.dev");
    expect(conf.apiUrl).toBe("https://api.stg.kagami.kyosuke.dev");
  });

  it("VITE_LIFF_ID が設定されている場合に liffId が取得されること", () => {
    vi.stubEnv("VITE_LIFF_ID", "1234567890-abcdefgh");

    expect(getWebConfig().liffId).toBe("1234567890-abcdefgh");
  });

  it("LIFF_ID を明示的に渡した場合に liffId が取得されること", () => {
    expect(getWebConfig({ LIFF_ID: "1234567890-abcdefgh" }).liffId).toBe("1234567890-abcdefgh");
  });

  it("VITE_LIFF_ID が未設定の場合に liffId が undefined になること", () => {
    expect(getWebConfig({ LIFF_ID: undefined }).liffId).toBeUndefined();
  });

  it("VITE_LIFF_ID が空文字や空白のみの場合に未設定として扱われること", () => {
    expect(getWebConfig({ LIFF_ID: "" }).liffId).toBeUndefined();
    expect(getWebConfig({ LIFF_ID: "   " }).liffId).toBeUndefined();
  });
});
