import { describe, expect, it } from "vitest";
import { classifyDailyPromptControl } from "./text";

describe("classifyDailyPromptControl", () => {
  it.each([
    "声かけを止めて",
    "毎日の声掛けを停止してください",
    "18時のメッセージを送らないで",
    "通知しないでください",
    "もう送らないで",
  ])("確定的な停止表現を判定する: %s", (text) => {
    expect(classifyDailyPromptControl(text)).toBe("stop");
  });

  it.each([
    "今日は通知を見ていない",
    "声かけはどういう仕組み？",
    "今日はもう送らないで寝る",
    "声かけを再開して",
    "また送って",
    "通知を見られるようになった",
  ])("停止表現以外を制御操作として扱わない: %s", (text) => {
    expect(classifyDailyPromptControl(text)).toBeUndefined();
  });
});
