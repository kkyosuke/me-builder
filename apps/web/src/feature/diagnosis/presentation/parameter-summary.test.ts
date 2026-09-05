import { describe, expect, it } from "vitest";
import { getParameterComparisonSummary, getParameterScoreSummary } from "./parameter-summary";

describe("getParameterScoreSummary", () => {
  const labels = { lowLabel: "低い側", highLabel: "高い側" };

  it.each([
    ["low", "低い側"],
    ["balanced", "中央"],
    ["high", "高い側"],
    ["insufficient", "回答不足"],
  ] as const)("%sの表示文を返す", (band, expected) => {
    expect(getParameterScoreSummary({ score: null, coverage: 0, band }, labels, "中央")).toBe(
      expected,
    );
  });
});

describe("getParameterComparisonSummary", () => {
  it.each([
    [null, "まだ比較できません。"],
    [
      { difference: 10, relation: "same_band" as const },
      "普段の行動と大切にしたいことは、同じ傾向の範囲です。",
    ],
    [
      { difference: 50, relation: "desired_higher" as const },
      "大切にしたいことの方が、普段の行動より「高い側」側です。",
    ],
    [
      { difference: -50, relation: "behavior_higher" as const },
      "普段の行動の方が、大切にしたいことより「高い側」側です。",
    ],
  ])("比較関係を中立な表示文へ変換する", (comparison, expected) => {
    expect(getParameterComparisonSummary({ highLabel: "高い側", comparison })).toBe(expected);
  });
});
