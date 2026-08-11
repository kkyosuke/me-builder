import { D1 } from "@me-builder/lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiUsageRecorder } from "./gemini-usage";

const usage = {
  responseId: "response-1",
  model: "gemini-test",
  promptTokenCount: 10,
  candidatesTokenCount: 4,
  thoughtsTokenCount: 2,
  cachedContentTokenCount: 3,
  toolUsePromptTokenCount: 1,
  totalTokenCount: 17,
  generatedAt: new Date("2026-08-10T08:00:00.000Z"),
};

describe("Gemini usage recorder", () => {
  afterEach(() => vi.restoreAllMocks());

  it("用途を付けてtoken利用量を保存する", async () => {
    const store = vi
      .spyOn(D1.shared.action.geminiUsage, "storeGeminiUsage")
      .mockResolvedValueOnce(undefined);
    const db = {} as D1.shared.Client;

    await createGeminiUsageRecorder(db, "diary_chat", "account-1")(usage);

    expect(store).toHaveBeenCalledWith(db, {
      ...usage,
      operation: "diary_chat",
      accountId: "account-1",
    });
  });

  it("保存失敗で生成処理を失敗させない", async () => {
    vi.spyOn(D1.shared.action.geminiUsage, "storeGeminiUsage").mockRejectedValueOnce(
      new Error("D1 unavailable"),
    );

    await expect(
      createGeminiUsageRecorder({} as D1.shared.Client, "diary_brain", "account-1")(usage),
    ).resolves.toBe(undefined);
  });
});
