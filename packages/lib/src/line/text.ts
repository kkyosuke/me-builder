export type LineTextIntent = "diagnosis-request" | "diary";
export type DailyPromptControl = "stop";

const DIAGNOSIS_KEYWORDS = [
  "診断",
  "しんだん",
  "今日の診断",
  "今日のしんだん",
  "きょうの診断",
  "きょうのしんだん",
];

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));
}

function normalizeControlText(text: string): string {
  return normalize(text).replace(/[\s。、！？!?…・]/g, "");
}

const DAILY_PROMPT_STOP_PATTERNS = [
  /^(?:モウ)?(?:毎日(?:ノ)?|日々(?:ノ)?|18時(?:ノ)?)?(?:声カケ|声掛ケ|メッセージ|通知)(?:ヲ)?(?:止メテ|停止シテ|送ラナイデ|シナイデ)(?:クダサイ)?$/,
  /^(?:モウ)?送ラナイデ(?:クダサイ)?$/,
] as const;

/** LINEテキストを決定的な完全一致ルールでroutingする。 */
export function classifyLineText(text: string): LineTextIntent {
  const normalized = normalize(text);
  return DIAGNOSIS_KEYWORDS.some((keyword) => normalize(keyword) === normalized)
    ? "diagnosis-request"
    : "diary";
}

/** 誤停止を避けるため、声かけ停止の意味が確定する表現だけを判定する。 */
export function classifyDailyPromptControl(text: string): DailyPromptControl | undefined {
  const normalized = normalizeControlText(text);
  return DAILY_PROMPT_STOP_PATTERNS.some((pattern) => pattern.test(normalized))
    ? "stop"
    : undefined;
}

export const lineText = {
  classify: classifyLineText,
  classifyDailyPromptControl,
};
