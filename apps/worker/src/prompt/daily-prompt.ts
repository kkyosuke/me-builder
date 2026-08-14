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
};

/** Asia/Tokyoで解決済みの配送日から、曜日別の一般文面versionを選ぶ。 */
export function getDailyPromptVersion(localDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("Daily prompt date is invalid");
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== localDate) {
    throw new Error("Daily prompt date is invalid");
  }
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
