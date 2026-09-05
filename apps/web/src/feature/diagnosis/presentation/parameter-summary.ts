import type { ParameterScore, ScoredParameter } from "../model/diagnosis-result";

export function getParameterScoreSummary(
  score: ParameterScore,
  labels: Pick<ScoredParameter, "lowLabel" | "highLabel">,
  balancedLabel: string,
): string {
  switch (score.band) {
    case "low":
      return labels.lowLabel;
    case "high":
      return labels.highLabel;
    case "balanced":
      return balancedLabel;
    case "insufficient":
      return "回答不足";
  }
}
