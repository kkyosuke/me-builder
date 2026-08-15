import { describe, expect, it } from "vitest";
import type { CompatibilityPerson, CompatibilityTheme } from "./compatibility";
import { compareCompatibilityThemes } from "./compatibility-comparison";

const theme = (
  id: string,
  band: CompatibilityTheme["band"],
  position: number,
): CompatibilityTheme => ({
  id,
  title: id,
  axis: id,
  leftLabel: "低い",
  rightLabel: "高い",
  position,
  statement: `${id}の傾向`,
  request: "",
  band,
});

const person = (themes: CompatibilityTheme[]): CompatibilityPerson => ({
  name: "テスト",
  initial: "テ",
  color: "sky",
  profileGeneratedAt: "2026-08-15T00:00:00.000Z",
  statements: ["テスト用の文章"],
  themes,
});

describe("compareCompatibilityThemes", () => {
  it("採点済み帯域から共通・違い・未確定を分類する", () => {
    const result = compareCompatibilityThemes(
      person([
        theme("common", "high", 55),
        theme("different", "low", 45),
        theme("undecided", "balanced", 80),
      ]),
      person([
        theme("common", "high", 45),
        theme("different", "high", 55),
        theme("undecided", "high", 20),
      ]),
    );

    expect(result.common.map(({ theme }) => theme.id)).toEqual(["common"]);
    expect(result.different.map(({ theme }) => theme.id)).toEqual(["different"]);
    expect(result.undecided.map(({ theme }) => theme.id)).toEqual(["undecided"]);
  });
});
