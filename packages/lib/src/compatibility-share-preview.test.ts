import { describe, expect, it } from "vitest";
import {
  buildCompatibilitySharePreviewThemes,
  selectCommonCompatibilityDiagnoses,
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

  it("双方が現在共有できるDiagnosisの共通部分だけを、閲覧者側の順序で選ぶ", () => {
    const diagnosis = (diagnosisId: string) => ({
      diagnosisId,
      title: diagnosisId,
      scoringConfigId: `${diagnosisId}-v1`,
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
    });

    expect(
      selectCommonCompatibilityDiagnoses(
        [diagnosis("diagnosis-1"), diagnosis("diagnosis-2"), diagnosis("diagnosis-3")],
        [diagnosis("diagnosis-3"), diagnosis("diagnosis-1")],
      ),
    ).toEqual(["diagnosis-1", "diagnosis-3"]);
    expect(selectCommonCompatibilityDiagnoses([diagnosis("diagnosis-1")], [])).toEqual([]);
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
