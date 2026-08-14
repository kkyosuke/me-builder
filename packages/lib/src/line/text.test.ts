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
    "声かけを再開して",
    "毎日の声掛けを再開してください",
    "18時のメッセージをまた送って",
    "通知をまた送ってください",
  ])("確定的な再開表現を判定する: %s", (text) => {
    expect(classifyDailyPromptControl(text)).toBe("resume");
  });

  it.each([
    "今日は通知を見ていない",
    "声かけはどういう仕組み？",
    "今日はもう送らないで寝る",
    "また送って",
    "通知を見られるようになった",
  ])("曖昧な発言を制御操作として扱わない: %s", (text) => {
    expect(classifyDailyPromptControl(text)).toBeUndefined();
  });
});
