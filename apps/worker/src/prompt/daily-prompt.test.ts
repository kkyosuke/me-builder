import { describe, expect, it } from "vitest";
import {
  LEGACY_DAILY_PROMPT_VERSION,
  getDailyPromptText,
  getDailyPromptVersion,
} from "./daily-prompt";

describe("daily prompt", () => {
  it.each([
    [
      "2026-08-10",
      "daily-check-in-mon-v1",
      "今日はどんな一日だった？\nまずは、いちばん印象に残ったことから聞かせて。",
    ],
    [
      "2026-08-11",
      "daily-check-in-tue-v1",
      "今日、ちょっと気になったことや心に残ったことはあった？",
    ],
    [
      "2026-08-12",
      "daily-check-in-wed-v1",
      "今日はどんなことがあった？\nまとまっていなくても大丈夫だよ。",
    ],
    ["2026-08-13", "daily-check-in-thu-v1", "今日を振り返ると、どんな場面が浮かぶ？"],
    ["2026-08-14", "daily-check-in-fri-v1", "今日、少しでも話しておきたいことはある？"],
    [
      "2026-08-15",
      "daily-check-in-sat-v1",
      "今日はどんなふうに過ごした？\nひとことだけでも聞かせて。",
    ],
    ["2026-08-16", "daily-check-in-sun-v1", "今日はどんな一日だった？\n話したいことから聞かせて。"],
  ])("Asia/Tokyoの配送日%sに対応する文面versionを選ぶ", (localDate, version, expectedText) => {
    expect(getDailyPromptVersion(localDate)).toBe(version);
    expect(getDailyPromptText(version)).toBe(expectedText);
  });

  it.each(["", "2026-8-10", "2026-02-30", "invalid"])("不正な配送日を拒否する: %s", (localDate) => {
    expect(() => getDailyPromptVersion(localDate)).toThrow("Daily prompt date is invalid");
  });

  it("段階1の固定文面versionを既存配送向けに保持する", () => {
    expect(getDailyPromptText(LEGACY_DAILY_PROMPT_VERSION)).toBe(
      "今日はどうだった？\n短いひとことでも、まとまっていなくても大丈夫だよ。",
    );
  });

  it("未対応の文面versionを拒否する", () => {
    expect(() => getDailyPromptText("unknown")).toThrow("Daily prompt version is not supported");
  });
});
