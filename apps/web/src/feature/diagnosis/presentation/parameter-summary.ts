import type { ScoredParameter } from "../model/diagnosis-result";

export function getParameterSummary(parameter: ScoredParameter, balancedLabel: string): string {
  switch (parameter.band) {
    case "low":
      return parameter.lowLabel;
    case "high":
      return parameter.highLabel;
    case "balanced":
      return balancedLabel;
    case "insufficient":
      return "回答不足";
  }
}
