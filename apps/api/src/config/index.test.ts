import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { ConfigSchema, getConfig } from "./index";

describe("getConfig & ConfigSchema", () => {
  it("Valibot スキーマでデフォルト値が正しく補完されること", () => {
    const parsed = v.parse(ConfigSchema, {});
    expect(parsed.port).toBe(3000);
    expect(parsed.environment).toBe("development");
    expect(parsed.lineWebhookUrl).toBeUndefined();
    expect(getConfig({}).billingLookupKeyMap).toEqual({
      "lite.month": "me_builder_lite_monthly",
      "lite.year": "me_builder_lite_yearly",
      "full.month": "me_builder_full_monthly",
      "full.year": "me_builder_full_yearly",
      "family.month": "me_builder_family_monthly",
      "family.year": "me_builder_family_yearly",
    });
  });

  it("Cloudflare Worker またはローカルの env マップから値を取得・解析すること", () => {
    const conf = getConfig({
      ENVIRONMENT: "preview",
      BASE_DOMAIN: "stg.kagami.kyosuke.dev",
      LINE_CHANNEL_ACCESS_TOKEN: "preview-token",
      LINE_CHANNEL_SECRET: "preview-channel-secret",
      WEB_ORIGIN: "https://stg.kagami.kyosuke.dev",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_managed",
      STRIPE_PORTAL_PLAN_CHANGE_CONFIGURATION_ID: "bpc_plan_change",
      STRIPE_PORTAL_RESET_CONFIGURATION_ID: "bpc_reset",
    });
    expect(conf.environment).toBe("preview");
    expect(conf.baseDomain).toBe("stg.kagami.kyosuke.dev");
    expect(conf.baseUrl).toBe("https://api.stg.kagami.kyosuke.dev");
    expect(conf.lineWebhookUrl).toBe("https://api.stg.kagami.kyosuke.dev/api/line/webhook");
    expect(conf.lineChannelAccessToken).toBe("preview-token");
    expect(conf.lineChannelSecret).toBe("preview-channel-secret");
    expect(conf.webOrigin).toBe("https://stg.kagami.kyosuke.dev");
    expect(conf.stripePortalConfigurationId).toBe("bpc_managed");
    expect(conf.stripePortalPlanChangeConfigurationId).toBe("bpc_plan_change");
    expect(conf.stripePortalResetConfigurationId).toBe("bpc_reset");
  });

  it("WEB_ORIGIN が未設定の場合は undefined になりワイルドカードへ補完されないこと", () => {
    const conf = getConfig({ ENVIRONMENT: "production", WEB_ORIGIN: undefined });

    expect(conf.webOrigin).toBeUndefined();
  });

  it("LINE_CHANNEL_SECRET が未設定の場合は undefined になること", () => {
    const parsed = v.parse(ConfigSchema, {});
    expect(parsed.lineChannelSecret).toBeUndefined();
  });

  it("BASE_DOMAIN から BASE_URL および LINE_WEBHOOK_URL が自動補完されること", () => {
    const conf = getConfig({
      BASE_DOMAIN: "stg.kagami.kyosuke.dev",
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

  it("課金catalogのruntime対応表と監視閾値を環境ごとに差し替えること", () => {
    const conf = getConfig({
      BILLING_LOOKUP_KEY_MAP: JSON.stringify({
        "lite.month": "lite_month_v2",
        "unknown.month": "must_be_ignored",
      }),
      BILLING_PRICE_PLAN_MAP: JSON.stringify({ price_lite_v2: "lite" }),
      BILLING_PROJECTION_STALE_AFTER_SECONDS: "1200",
    });
    expect(conf.billingLookupKeyMap).toEqual({ "lite.month": "lite_month_v2" });
    expect(conf.billingPricePlanMap).toEqual({ price_lite_v2: "lite" });
    expect(conf.billingProjectionStaleAfterSeconds).toBe(1200);
  });

  it("監視閾値の空環境変数は未設定として既定値を使う", () => {
    expect(
      getConfig({ BILLING_PROJECTION_STALE_AFTER_SECONDS: "" }).billingProjectionStaleAfterSeconds,
    ).toBe(900);
    expect(
      getConfig({ BILLING_PROJECTION_STALE_AFTER_SECONDS: "   " })
        .billingProjectionStaleAfterSeconds,
    ).toBe(900);
  });

  it("LINE_WEBHOOK_URL が明示されている場合は BASE_URL より優先されること", () => {
    const conf = getConfig({
      BASE_URL: "https://example.com",
      LINE_WEBHOOK_URL: "https://custom.com/webhook",
    });

    expect(conf.lineWebhookUrl).toBe("https://custom.com/webhook");
  });

  it("LIFF IDからLINE LoginチャネルIDを補完すること", () => {
    const conf = getConfig({ LIFF_ID: "2010850319-Yl63upAR" });
    expect(conf.liffId).toBe("2010850319-Yl63upAR");
    expect(conf.lineLoginChannelId).toBe("2010850319");
  });

  it("不正なLIFF IDを拒否すること", () => {
    expect(() => getConfig({ LIFF_ID: "not-a-liff-id" })).toThrow("LIFF_ID");
  });

  it("明示チャネルIDとLIFF IDの接頭辞が不一致なら拒否すること", () => {
    expect(() =>
      getConfig({
        LIFF_ID: "2010850319-Yl63upAR",
        LINE_LOGIN_CHANNEL_ID: "9999999999",
      }),
    ).toThrow("must match");
  });
});
