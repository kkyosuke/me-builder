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
});
