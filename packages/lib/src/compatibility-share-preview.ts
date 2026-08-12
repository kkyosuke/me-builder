import type { DiagnosisScoring, ScoredParameter } from "./diagnosis";
import type { CompatibilityShareProfile } from "./profile-summary";

export type CompatibilitySharePreviewParameter = Readonly<{
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  position: number;
  statement: string;
}>;

export type CompatibilitySharePreviewTheme = Readonly<{
  diagnosisId: string;
  title: string;
  parameters: readonly CompatibilitySharePreviewParameter[];
}>;

export type CompatibilitySharePreviewDiagnosis = Readonly<{
  diagnosisId: string;
  title: string;
  scoringConfigId: string;
  scoring: DiagnosisScoring;
}>;

const PREVIEW_TOKEN_VERSION = "csp2";

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

/** 採点済みDiagnosisを、回答やcoverageを含まない本人確認用の共有表示へ変換する。 */
export function buildCompatibilitySharePreviewThemes(
  diagnoses: readonly CompatibilitySharePreviewDiagnosis[],
): CompatibilitySharePreviewTheme[] {
  return diagnoses.flatMap(({ diagnosisId, title, scoring }) => {
    const parameters = scoring.parameters.flatMap(
      (parameter): CompatibilitySharePreviewParameter[] => {
        const bandLabel = displayBandLabel(parameter, scoring.balancedLabel);
        if (parameter.score === null || bandLabel === null) return [];

        return [
          {
            id: parameter.id,
            label: parameter.label,
            lowLabel: parameter.lowLabel,
            highLabel: parameter.highLabel,
            position: parameter.score,
            statement: `「${bandLabel}」傾向があります`,
          },
        ];
      },
    );
    if (parameters.length === 0) return [];
    return [{ diagnosisId, title, parameters }];
  });
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 発行時に確認したテーマ表示を、後続の再確認に使う外部非公開の指紋へ変換する。 */
export async function createCompatibilityShareThemeFingerprints(
  diagnoses: readonly CompatibilitySharePreviewDiagnosis[],
): Promise<Array<{ diagnosisId: string; resultFingerprint: string }>> {
  return Promise.all(
    diagnoses.flatMap((diagnosis) => {
      const theme = buildCompatibilitySharePreviewThemes([diagnosis])[0];
      if (!theme) return [];
      const canonical = JSON.stringify({
        schemaVersion: 1,
        diagnosisId: diagnosis.diagnosisId,
        scoringConfigId: diagnosis.scoringConfigId,
        scoringVersion: diagnosis.scoring.scoringVersion,
        theme,
      });
      return [
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)).then((digest) => ({
          diagnosisId: diagnosis.diagnosisId,
          resultFingerprint: bytesToHex(digest),
        })),
      ];
    }),
  );
}

/** 表示内容と採点設定版を、後続commandで再計算できる不透明な確認tokenへ変換する。 */
export async function createCompatibilitySharePreviewToken(
  displayName: string | null,
  shareProfile: CompatibilityShareProfile | null,
  diagnoses: readonly CompatibilitySharePreviewDiagnosis[],
): Promise<string> {
  const themes = diagnoses.flatMap((diagnosis) => {
    const theme = buildCompatibilitySharePreviewThemes([diagnosis])[0];
    return theme
      ? [
          {
            ...theme,
            scoringConfigId: diagnosis.scoringConfigId,
            scoringVersion: diagnosis.scoring.scoringVersion,
          },
        ]
      : [];
  });
  const canonical = JSON.stringify({ version: 2, displayName, shareProfile, themes });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `${PREVIEW_TOKEN_VERSION}.${bytesToHex(digest)}`;
}
