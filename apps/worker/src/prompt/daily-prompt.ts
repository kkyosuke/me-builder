import type { DailyPromptWeekdayContext, PromptContextWeekday } from "@me-builder/lib";

/** 段階1で作成済みの配送を再送できるよう保持する。 */
export const LEGACY_DAILY_PROMPT_VERSION = "daily-check-in-v1";

const DAILY_PROMPT_VERSION_BY_WEEKDAY = [
  "daily-check-in-sun-v1",
  "daily-check-in-mon-v1",
  "daily-check-in-tue-v1",
  "daily-check-in-wed-v1",
  "daily-check-in-thu-v1",
  "daily-check-in-fri-v1",
  "daily-check-in-sat-v1",
] as const;

const DAILY_PROMPT_VERSION_BY_WEEKDAY_CONTEXT = {
  recurring_schedule: "daily-check-in-recurring-schedule-v1",
  day_off: "daily-check-in-day-off-v1",
  active_day: "daily-check-in-active-day-v1",
} as const satisfies Readonly<Record<DailyPromptWeekdayContext, string>>;

const PROMPT_CONTEXT_WEEKDAY_BY_DAY = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const satisfies readonly PromptContextWeekday[];

const DAILY_PROMPTS: Readonly<Record<string, string>> = {
  [LEGACY_DAILY_PROMPT_VERSION]:
    "今日はどうだった？\n短いひとことでも、まとまっていなくても大丈夫だよ。",
  "daily-check-in-mon-v1":
    "今日はどんな一日だった？\nまずは、いちばん印象に残ったことから聞かせて。",
  "daily-check-in-tue-v1": "今日、ちょっと気になったことや心に残ったことはあった？",
  "daily-check-in-wed-v1": "今日はどんなことがあった？\nまとまっていなくても大丈夫だよ。",
  "daily-check-in-thu-v1": "今日を振り返ると、どんな場面が浮かぶ？",
  "daily-check-in-fri-v1": "今日、少しでも話しておきたいことはある？",
  "daily-check-in-sat-v1": "今日はどんなふうに過ごした？\nひとことだけでも聞かせて。",
  "daily-check-in-sun-v1": "今日はどんな一日だった？\n話したいことから聞かせて。",
  "daily-check-in-recurring-schedule-v1":
    "今日は、いつもの予定がある日だったかな。\n落ち着いたら、今日のことを話したいところから聞かせて。",
  "daily-check-in-day-off-v1":
    "今日は、普段だとお休みの日だったかな。\n違っていたら気にせず、今日のことを話したいところから聞かせて。",
  "daily-check-in-active-day-v1":
    "今日は、普段だと予定のある日だったかな。\n落ち着いたら、今日のことをひとことだけでも聞かせて。",
};

/** Asia/Tokyoで解決済みの配送日を声かけコンテキストの曜日へ変換する。 */
export function getDailyPromptWeekday(localDate: string): PromptContextWeekday {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("Daily prompt date is invalid");
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== localDate) {
    throw new Error("Daily prompt date is invalid");
  }
  const weekday = PROMPT_CONTEXT_WEEKDAY_BY_DAY[parsed.getUTCDay()];
  if (!weekday) throw new Error("Daily prompt weekday is invalid");
  return weekday;
}

/** 配送日と利用可能な曜日文脈から、版付き定型文を選ぶ。 */
export function getDailyPromptVersion(
  localDate: string,
  weekdayContext?: DailyPromptWeekdayContext,
): string {
  getDailyPromptWeekday(localDate);
  if (weekdayContext) return DAILY_PROMPT_VERSION_BY_WEEKDAY_CONTEXT[weekdayContext];
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  const version = DAILY_PROMPT_VERSION_BY_WEEKDAY[parsed.getUTCDay()];
  if (!version) throw new Error("Daily prompt weekday is invalid");
  return version;
}

/** Queue再配送時も準備時に固定したversionと同じ本文を返す。 */
export function getDailyPromptText(version: string): string {
  const text = DAILY_PROMPTS[version];
  if (!text) throw new Error("Daily prompt version is not supported");
  return text;
}
