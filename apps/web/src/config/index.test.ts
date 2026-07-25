import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { WebConfigSchema, getWebConfig } from "./index";

describe("getWebConfig & WebConfigSchema", () => {
  it("Valibot スキーマでデフォルト値が正しく補完されること", () => {
    const parsed = v.parse(WebConfigSchema, {});
    expect(parsed.environment).toBe("development");
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
});
