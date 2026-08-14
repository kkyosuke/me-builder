export const DAILY_PROMPT_VERSION = "daily-check-in-v1";

const DAILY_PROMPTS: Readonly<Record<string, string>> = {
  [DAILY_PROMPT_VERSION]: "今日はどうだった？\n短いひとことでも、まとまっていなくても大丈夫だよ。",
};

/** Queue再配送時も準備時に固定したversionと同じ本文を返す。 */
export function getDailyPromptText(version: string): string {
  const text = DAILY_PROMPTS[version];
  if (!text) throw new Error("Daily prompt version is not supported");
  return text;
}
