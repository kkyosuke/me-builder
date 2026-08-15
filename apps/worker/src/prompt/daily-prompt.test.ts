import { describe, expect, it } from "vitest";
import {
  LEGACY_DAILY_PROMPT_VERSION,
  getDailyPromptContextCutoffAt,
  getDailyPromptText,
  getDailyPromptVersion,
  getDailyPromptWeekday,
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

  it("配送日を声かけ属性と共通の曜日へ変換する", () => {
    expect(getDailyPromptWeekday("2026-08-10")).toBe("monday");
    expect(getDailyPromptWeekday("2026-08-16")).toBe("sunday");
  });

  it("日中文脈の締切を配送日の18:00 JSTへ固定する", () => {
    expect(getDailyPromptContextCutoffAt("2026-08-14")).toEqual(
      new Date("2026-08-14T09:00:00.000Z"),
    );
  });

  it.each([
    [
      "recurring_schedule",
      "daily-check-in-recurring-schedule-v1",
      "今日は、いつもの予定がある日だったかな。\n落ち着いたら、今日のことを話したいところから聞かせて。",
    ],
    [
      "day_off",
      "daily-check-in-day-off-v1",
      "今日は、普段だとお休みの日だったかな。\n違っていたら気にせず、今日のことを話したいところから聞かせて。",
    ],
    [
      "active_day",
      "daily-check-in-active-day-v1",
      "今日は、普段だと予定のある日だったかな。\n落ち着いたら、今日のことをひとことだけでも聞かせて。",
    ],
  ] as const)("%sでは予定名を含まない版付き定型文を選ぶ", (context, version, text) => {
    expect(getDailyPromptVersion("2026-08-10", context)).toBe(version);
    expect(getDailyPromptText(version)).toBe(text);
  });

  it("同日フォローを曜日文脈より優先する", () => {
    const version = getDailyPromptVersion("2026-08-10", "day_off", "same_day");

    expect(version).toBe("daily-check-in-same-day-follow-up-v1");
    expect(getDailyPromptText(version)).toBe(
      "日中に話してくれたこと、その後はどう？\n話題を変えて、今日全体のことを話しても大丈夫だよ。",
    );
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
