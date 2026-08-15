import type { DiagnosisScoring, ScoredParameter } from "./diagnosis";

export type CompatibilitySharePreviewParameter = Readonly<{
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  position: number;
  statement: string;
  request?: string;
  band: "low" | "balanced" | "high";
}>;

export type CompatibilitySharePreviewTheme = Readonly<{
  diagnosisId: string;
  title: string;
  scoringConfigId: string;
  scoringVersion: number;
  parameters: readonly CompatibilitySharePreviewParameter[];
}>;

export type CompatibilitySharePreviewDiagnosis = Readonly<{
  diagnosisId: string;
  title: string;
  scoringConfigId: string;
  scoring: DiagnosisScoring;
}>;

function displayBandLabel(parameter: ScoredParameter, balancedLabel: string): string | null {
  switch (parameter.band) {
    case "low":
      return parameter.lowLabel;
    case "balanced":
      return balancedLabel;
    case "high":
      return parameter.highLabel;
    case "insufficient":
      return null;
  }
}

/** 採点済みDiagnosisを、回答やcoverageを含まない共有表示へ変換する。 */
export function buildCompatibilitySharePreviewThemes(
  diagnoses: readonly CompatibilitySharePreviewDiagnosis[],
): CompatibilitySharePreviewTheme[] {
  return diagnoses.flatMap(({ diagnosisId, title, scoringConfigId, scoring }) => {
    const parameters = scoring.parameters.flatMap(
      (parameter): CompatibilitySharePreviewParameter[] => {
        if (parameter.score === null || parameter.band === "insufficient") return [];
        const bandLabel = displayBandLabel(parameter, scoring.balancedLabel);
        if (bandLabel === null) return [];

        return [
          {
            id: parameter.id,
            label: parameter.label,
            lowLabel: parameter.lowLabel,
            highLabel: parameter.highLabel,
            position: parameter.score,
            statement: `「${bandLabel}」傾向があります`,
            ...(parameter.relationshipRequest ? { request: parameter.relationshipRequest } : {}),
            band: parameter.band,
          },
        ];
      },
    );
    if (parameters.length === 0) return [];
    return [
      {
        diagnosisId,
        title,
        scoringConfigId,
        scoringVersion: scoring.scoringVersion,
        parameters,
      },
    ];
  });
}

/**
 * 双方が現在共有できる表示から、比較に使う共通テーマだけを選ぶ。
 * 採点できないパラメータだけのDiagnosisは表示側で除外されるため、
 * 比較対象は回答の有無ではなく実際に表示でき、採点設定IDと版が一致するテーマで判定する。
 * 双方へ同じ相性シートを見せるため、順序は`primary`側だけで決める。
 */
export function selectCommonCompatibilityDiagnoses(
  primary: readonly {
    diagnosisId: string;
    scoringConfigId: string;
    scoringVersion: number;
  }[],
  secondary: readonly {
    diagnosisId: string;
    scoringConfigId: string;
    scoringVersion: number;
  }[],
): string[] {
  const secondaryDefinitions = new Set(
    secondary.map(
      ({ diagnosisId, scoringConfigId, scoringVersion }) =>
        `${diagnosisId}\0${scoringConfigId}\0${scoringVersion}`,
    ),
  );
  return primary
    .filter(({ diagnosisId, scoringConfigId, scoringVersion }) =>
      secondaryDefinitions.has(`${diagnosisId}\0${scoringConfigId}\0${scoringVersion}`),
    )
    .map(({ diagnosisId }) => diagnosisId);
}
