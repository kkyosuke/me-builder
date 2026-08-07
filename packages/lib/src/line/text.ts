export type LineTextIntent = "diagnosis-request" | "diary";

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

/** LINEテキストを決定的な完全一致ルールでroutingする。 */
export function classifyLineText(text: string): LineTextIntent {
  const normalized = normalize(text);
  return DIAGNOSIS_KEYWORDS.some((keyword) => normalize(keyword) === normalized)
    ? "diagnosis-request"
    : "diary";
}

export const lineText = { classify: classifyLineText };
