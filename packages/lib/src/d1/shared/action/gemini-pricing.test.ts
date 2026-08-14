import { describe, expect, it } from "vitest";
import { estimateGeminiCostUsd, splitByGeminiPricingPeriods } from "./gemini-pricing";

const generatedAt = new Date("2026-08-10T00:00:00.000Z");
const usage = {
  promptTokenCount: 100,
  candidatesTokenCount: 20,
  thoughtsTokenCount: 5,
  cachedContentTokenCount: 10,
  toolUsePromptTokenCount: 2,
};

describe("Gemini pricing", () => {
  it("生成時刻に有効な単価で通常入力・cache・出力と思考を計算する", () => {
    expect(estimateGeminiCostUsd("gemini-3.5-flash-lite-001", usage, generatedAt)).toEqual({
      status: "available",
      amountUsd: 0.0000904,
    });
  });

  it("算出できない理由を区別する", () => {
    expect(estimateGeminiCostUsd("gemini-future", usage, generatedAt)).toEqual({
      status: "unavailable",
      reason: "unsupported-model",
    });
    expect(
      estimateGeminiCostUsd(
        "gemini-3.5-flash-lite",
        { ...usage, cachedContentTokenCount: usage.promptTokenCount + 1 },
        generatedAt,
      ),
    ).toEqual({ status: "unavailable", reason: "invalid-usage" });
    expect(
      estimateGeminiCostUsd(
        "gemini-3.5-flash-lite",
        {
          ...usage,
          promptTokenCount: Number.MAX_SAFE_INTEGER,
          cachedContentTokenCount: 0,
        },
        generatedAt,
      ),
    ).toEqual({ status: "unavailable", reason: "overflow" });
  });

  it("集計期間を単価の有効期間で分ける", () => {
    const start = new Date("2026-07-20T00:00:00.000Z");
    const effectiveFrom = new Date("2026-07-21T00:00:00.000Z");
    const end = new Date("2026-07-22T00:00:00.000Z");

    expect(splitByGeminiPricingPeriods(start, end)).toEqual([
      { start, end: effectiveFrom },
      { start: effectiveFrom, end },
    ]);
  });
});
