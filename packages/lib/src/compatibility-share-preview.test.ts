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
                resultKind: "aggregate",
                score: 20,
                coverage: 100,
                band: "low",
                behavior: null,
                comparison: null,
              },
              {
                id: "balanced",
                label: "中央の軸",
                lowLabel: "少なめ",
                highLabel: "多め",
                resultKind: "aggregate",
                score: 50,
                coverage: 100,
                band: "balanced",
                behavior: null,
                comparison: null,
              },
              {
                id: "high",
                label: "高い軸",
                lowLabel: "ゆっくり",
                highLabel: "すばやく",
                resultKind: "aggregate",
                score: 80,
                coverage: 100,
                band: "high",
                behavior: null,
                comparison: null,
                relationshipRequest: "早めに共有してもらえるとうれしいです。",
              },
            ],
          },
        },
      ]),
    ).toEqual([
      {
        diagnosisId: "diagnosis-1",
        title: "時間と予定",
        scoringConfigId: "time-planning-v1",
        scoringVersion: 1,
        parameters: [
          {
            id: "low",
            label: "低い軸",
            lowLabel: "その場で決めたい",
            highLabel: "早めに決めたい",
            position: 20,
            statement: "「その場で決めたい」傾向があります",
            band: "low",
          },
          {
            id: "balanced",
            label: "中央の軸",
            lowLabel: "少なめ",
            highLabel: "多め",
            position: 50,
            statement: "「状況に応じて決めたい」傾向があります",
            band: "balanced",
          },
          {
            id: "high",
            label: "高い軸",
            lowLabel: "ゆっくり",
            highLabel: "すばやく",
            position: 80,
            statement: "「すばやく」傾向があります",
            request: "早めに共有してもらえるとうれしいです。",
            band: "high",
          },
        ],
      },
    ]);
  });

  it("双方が現在共有できるDiagnosisの共通部分だけを、primary側の順序で選ぶ", () => {
    const diagnosis = (diagnosisId: string, scoringVersion = 1) => ({
      diagnosisId,
      title: diagnosisId,
      scoringConfigId: `${diagnosisId}-v1`,
      scoringVersion,
    });

    expect(
      selectCommonCompatibilityDiagnoses(
        [diagnosis("diagnosis-1"), diagnosis("diagnosis-2"), diagnosis("diagnosis-3")],
        [diagnosis("diagnosis-3"), diagnosis("diagnosis-1")],
      ),
    ).toEqual(["diagnosis-1", "diagnosis-3"]);
    expect(selectCommonCompatibilityDiagnoses([diagnosis("diagnosis-1")], [])).toEqual([]);
    expect(
      selectCommonCompatibilityDiagnoses(
        [diagnosis("diagnosis-1", 1)],
        [diagnosis("diagnosis-1", 2)],
      ),
    ).toEqual([]);
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
                resultKind: "aggregate",
                score: null,
                coverage: 20,
                band: "insufficient",
                behavior: null,
                comparison: null,
              },
            ],
          },
        },
      ]),
    ).toEqual([]);
  });

  it("表裏質問では大切にしたいことの主スコアを相性表示へ使う", () => {
    const [theme] = buildCompatibilitySharePreviewThemes([
      {
        diagnosisId: "diagnosis-1",
        title: "家族との時間",
        scoringConfigId: "family-v1",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況による",
          parameters: [
            {
              id: "family-time",
              label: "家族との時間",
              lowLabel: "自分の時間を優先する",
              highLabel: "家族との時間を優先する",
              resultKind: "behavior_desired",
              score: 100,
              coverage: 100,
              band: "high",
              behavior: { score: 0, coverage: 100, band: "low" },
              comparison: { difference: 100, relation: "desired_higher" },
            },
          ],
        },
      },
    ]);

    expect(theme?.parameters[0]).toMatchObject({
      position: 100,
      statement: "「家族との時間を優先する」傾向があります",
    });
  });
});
