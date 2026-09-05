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

export function getParameterComparisonSummary(
  parameter: Pick<ScoredParameter, "comparison" | "highLabel">,
): string {
  if (!parameter.comparison) return "まだ比較できません。";
  switch (parameter.comparison.relation) {
    case "same_band":
      return "普段の行動と大切にしたいことは、同じ傾向の範囲です。";
    case "desired_higher":
      return `大切にしたいことの方が、普段の行動より「${parameter.highLabel}」側です。`;
    case "behavior_higher":
      return `普段の行動の方が、大切にしたいことより「${parameter.highLabel}」側です。`;
  }
}
