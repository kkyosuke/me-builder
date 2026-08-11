import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { McpConfigSchema, getMcpConfig } from "./index";

describe("getMcpConfig & McpConfigSchema", () => {
  it("Valibot スキーマでデフォルト値が正しく補完されること", () => {
    const parsed = v.parse(McpConfigSchema, {});
    expect(parsed.port).toBe(3001);
    expect(parsed.environment).toBe("development");
  });

  it("BASE_DOMAIN から MCP URL および API URL が自動計算されること", () => {
    const conf = getMcpConfig({
      BASE_DOMAIN: "stg.kagami.kyosuke.dev",
      BASE_URL: undefined,
      API_URL: undefined,
    });

    expect(conf.baseDomain).toBe("stg.kagami.kyosuke.dev");
    expect(conf.baseUrl).toBe("https://mcp.stg.kagami.kyosuke.dev");
    expect(conf.apiUrl).toBe("https://api.stg.kagami.kyosuke.dev");
  });

  it("WEB_ORIGIN を許可Webオリジンとして取得すること", () => {
    const conf = getMcpConfig({ WEB_ORIGIN: "https://kagami.kyosuke.dev" });

    expect(conf.webOrigin).toBe("https://kagami.kyosuke.dev");
  });

  it("WEB_ORIGIN が未設定の場合は undefined になりワイルドカードへ補完されないこと", () => {
    const conf = getMcpConfig({ WEB_ORIGIN: undefined });

    expect(conf.webOrigin).toBeUndefined();
  });
});
