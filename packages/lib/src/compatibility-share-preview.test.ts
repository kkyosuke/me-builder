import { describe, expect, it } from "vitest";
import {
  buildCompatibilitySharePreviewThemes,
  createCompatibilitySharePreviewToken,
  createCompatibilityShareThemeFingerprints,
} from "./compatibility-share-preview";

describe("buildCompatibilitySharePreviewThemes", () => {
  it("帯域ラベルから本人向け文章を組み立て、採点順を維持する", () => {
    expect(
      buildCompatibilitySharePreviewThemes([
        {
          diagnosisId: "diagnosis-1",
          title: "時間と予定",
          scoringConfigId: "time-planning-v1",
          scoring: {
            scoringVersion: 1,
            balancedLabel: "状況に応じて決めたい",
            parameters: [
              {
                id: "low",
                label: "低い軸",
                lowLabel: "その場で決めたい",
                highLabel: "早めに決めたい",
                score: 20,
                coverage: 100,
                band: "low",
              },
              {
                id: "balanced",
                label: "中央の軸",
                lowLabel: "少なめ",
                highLabel: "多め",
                score: 50,
                coverage: 100,
                band: "balanced",
              },
              {
                id: "high",
                label: "高い軸",
                lowLabel: "ゆっくり",
                highLabel: "すばやく",
                score: 80,
                coverage: 100,
                band: "high",
              },
            ],
          },
        },
      ]),
    ).toEqual([
      {
        diagnosisId: "diagnosis-1",
        title: "時間と予定",
        parameters: [
          {
            id: "low",
            label: "低い軸",
            lowLabel: "その場で決めたい",
            highLabel: "早めに決めたい",
            position: 20,
            statement: "「その場で決めたい」傾向があります",
          },
          {
            id: "balanced",
            label: "中央の軸",
            lowLabel: "少なめ",
            highLabel: "多め",
            position: 50,
            statement: "「状況に応じて決めたい」傾向があります",
          },
          {
            id: "high",
            label: "高い軸",
            lowLabel: "ゆっくり",
            highLabel: "すばやく",
            position: 80,
            statement: "「すばやく」傾向があります",
          },
        ],
      },
    ]);
  });

  it("同じ表示内容には同じtokenを返し、位置または採点設定版の変更を検出する", async () => {
    const diagnosis = {
      diagnosisId: "diagnosis-1",
      title: "時間と予定",
      scoringConfigId: "time-planning-v1",
      scoring: {
        scoringVersion: 1,
        balancedLabel: "状況に応じて決めたい",
        parameters: [
          {
            id: "planning",
            label: "予定",
            lowLabel: "その場",
            highLabel: "早め",
            score: 80,
            coverage: 100,
            band: "high" as const,
          },
        ],
      },
    };
    const parameter = diagnosis.scoring.parameters[0];
    if (!parameter) throw new Error("Expected a scored parameter");
    const shareProfile = {
      profileSummaryVersionId: "summary-version-1",
      generatedAt: "2026-08-11T00:00:00.000Z",
      statements: [{ key: "planning", label: "予定", statement: "私は、見通しがあると安心します" }],
      fingerprint: "a".repeat(64),
    };

    const token = await createCompatibilitySharePreviewToken("あおい", shareProfile, [diagnosis]);
    expect(token).toMatch(/^csp2\.[a-f0-9]{64}$/);
    await expect(
      createCompatibilitySharePreviewToken("あおい", shareProfile, [diagnosis]),
    ).resolves.toBe(token);
    await expect(
      createCompatibilitySharePreviewToken(
        "あおい",
        { ...shareProfile, profileSummaryVersionId: "summary-version-2" },
        [diagnosis],
      ),
    ).resolves.not.toBe(token);
    await expect(
      createCompatibilitySharePreviewToken("あおい", shareProfile, [
        { ...diagnosis, scoring: { ...diagnosis.scoring, scoringVersion: 2 } },
      ]),
    ).resolves.not.toBe(token);
    await expect(
      createCompatibilitySharePreviewToken("あおい", shareProfile, [
        { ...diagnosis, scoringConfigId: "time-planning-v2" },
      ]),
    ).resolves.not.toBe(token);
    await expect(
      createCompatibilitySharePreviewToken("あおい", shareProfile, [
        {
          ...diagnosis,
          scoring: {
            ...diagnosis.scoring,
            parameters: [{ ...parameter, score: 79 }],
          },
        },
      ]),
    ).resolves.not.toBe(token);
  });

  it("テーマごとに表示内容と採点設定版を含む指紋を作る", async () => {
    const diagnosis = {
      diagnosisId: "diagnosis-1",
      title: "時間と予定",
      scoringConfigId: "time-planning-v1",
      scoring: {
        scoringVersion: 1,
        balancedLabel: "状況による",
        parameters: [
          {
            id: "planning",
            label: "予定",
            lowLabel: "その場",
            highLabel: "早め",
            score: 80,
            coverage: 100,
            band: "high" as const,
          },
        ],
      },
    };

    const first = await createCompatibilityShareThemeFingerprints([diagnosis]);
    expect(first).toEqual([
      { diagnosisId: "diagnosis-1", resultFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    await expect(createCompatibilityShareThemeFingerprints([diagnosis])).resolves.toEqual(first);
    await expect(
      createCompatibilityShareThemeFingerprints([
        { ...diagnosis, scoring: { ...diagnosis.scoring, scoringVersion: 2 } },
      ]),
    ).resolves.not.toEqual(first);
  });

  it("計算不能なパラメータと空になったDiagnosisを共有対象から除外する", () => {
    expect(
      buildCompatibilitySharePreviewThemes([
        {
          diagnosisId: "diagnosis-1",
          title: "回答不足",
          scoringConfigId: "insufficient-v1",
          scoring: {
            scoringVersion: 1,
            balancedLabel: "状況による",
            parameters: [
              {
                id: "unknown",
                label: "未確定",
                lowLabel: "低い",
                highLabel: "高い",
                score: null,
                coverage: 20,
                band: "insufficient",
              },
            ],
          },
        },
      ]),
    ).toEqual([]);
  });
});
