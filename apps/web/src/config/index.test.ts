import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { WebConfigSchema, getWebConfig } from "./index";

// 環境変数は必ず引数で明示的に渡します。`import.meta.env` は Vite がビルド時に注入し
// テストから差し替えられないため、CI で `VITE_LIFF_ID` が設定されているかどうかで
// 結果が変わるテストを書いてはいけません。
describe("getWebConfig & WebConfigSchema", () => {
  it("環境変数未設定時はenvironmentを補完しないこと", () => {
    const parsed = v.parse(WebConfigSchema, {});
    expect(parsed.environment).toBeUndefined();
    expect(parsed.liffId).toBeUndefined();
  });

  it("ENVIRONMENT未設定時はNODE_ENVがdevelopmentでも開発環境にしないこと", () => {
    const conf = getWebConfig({ ENVIRONMENT: undefined, NODE_ENV: "development" });
    expect(conf.environment).toBeUndefined();
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

  it("LIFF ID が設定されている場合に liffId が取得されること", () => {
    expect(getWebConfig({ LIFF_ID: "1234567890-abcdefgh" }).liffId).toBe("1234567890-abcdefgh");
  });

  it("LIFF ID が未設定の場合に liffId が undefined になること", () => {
    expect(getWebConfig({ LIFF_ID: undefined }).liffId).toBeUndefined();
  });

  it("LIFF ID が空文字や空白のみの場合に未設定として扱われること", () => {
    expect(getWebConfig({ LIFF_ID: "" }).liffId).toBeUndefined();
    expect(getWebConfig({ LIFF_ID: "   " }).liffId).toBeUndefined();
  });

  it("不正なLIFF IDを画面のビルド・初期化前に拒否すること", () => {
    expect(() => getWebConfig({ LIFF_ID: "invalid" })).toThrow("LIFF_ID");
  });
});
