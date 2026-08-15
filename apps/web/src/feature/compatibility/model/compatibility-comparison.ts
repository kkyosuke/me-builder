import type { CompatibilityPerson, CompatibilityTheme } from "./compatibility";

type CompatibilityThemePair = {
  theme: CompatibilityTheme;
  partnerTheme: CompatibilityTheme;
};

export type CompatibilityThemeComparison = {
  common: CompatibilityThemePair[];
  different: CompatibilityThemePair[];
  undecided: CompatibilityThemePair[];
};

/** 採点設定が決めた帯域を使い、位置の数値から画面側で境界を再計算しない。 */
export function compareCompatibilityThemes(
  me: CompatibilityPerson,
  partner: CompatibilityPerson,
): CompatibilityThemeComparison {
  const pairs = me.themes.flatMap((theme) => {
    const partnerTheme = partner.themes.find((candidate) => candidate.id === theme.id);
    return partnerTheme ? [{ theme, partnerTheme }] : [];
  });
  const common = pairs.filter(
    ({ theme, partnerTheme }) => theme.band !== "balanced" && theme.band === partnerTheme.band,
  );
  const different = pairs.filter(
    ({ theme, partnerTheme }) =>
      (theme.band === "low" && partnerTheme.band === "high") ||
      (theme.band === "high" && partnerTheme.band === "low"),
  );
  const describedIds = new Set([...common, ...different].map(({ theme }) => theme.id));
  const undecided = pairs.filter(({ theme }) => !describedIds.has(theme.id));

  return { common, different, undecided };
}
