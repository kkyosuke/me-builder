import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { LineConfigSchema, line } from "./index";

describe("LineConfigSchema & line.Config", () => {
  it("parses valid line config correctly", () => {
    const raw: line.Config = {
      channelAccessToken: "test-token",
      webhookUrl: "https://example.com/api/line/webhook",
    };
    const parsed = v.parse(LineConfigSchema, raw);
    expect(parsed.channelAccessToken).toBe("test-token");
    expect(parsed.webhookUrl).toBe("https://example.com/api/line/webhook");
  });

  it("parses empty object with optional fields", () => {
    const parsed = v.parse(line.config.LineConfigSchema, {});
    expect(parsed.channelAccessToken).toBeUndefined();
    expect(parsed.webhookUrl).toBeUndefined();
  });
});
