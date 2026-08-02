import { describe, expect, it } from "vitest";
import {
  type ParameterScoringConfig,
  getParameterSummary,
  scoreParameters,
} from "./parameter-scoring";
import type { SurveyAnswer } from "./types";

type TestParameterId = "planning" | "flexibility";

const CONFIG = {
  version: 3,
  parameters: [
    { id: "planning", label: "計画性", lowLabel: "即興を好む", highLabel: "計画を好む" },
    {
      id: "flexibility",
      label: "柔軟性",
      lowLabel: "予定を守る",
      highLabel: "変更を楽しむ",
    },
  ],
  choiceScores: { yes: 1, neutral: 0, no: -1 },
  questions: {
    "q-plan": { questionVersion: 2, weights: { planning: 1, flexibility: -0.5 } },
    "q-change": { questionVersion: 1, weights: { planning: -1, flexibility: 1 } },
  },
  minimumCoverage: 0.6,
  lowMaximum: 35,
  highMinimum: 65,
  balancedLabel: "状況による",
} as const satisfies ParameterScoringConfig<TestParameterId>;

function answer(questionId: string, questionVersion: number, value: string): SurveyAnswer {
  return {
    kind: "choice",
    questionId,
    questionVersion,
    value,
    direction: "right",
    answeredAt: "2026-08-02T00:00:00.000Z",
  };
}

describe("scoreParameters", () => {
  it("設定した選択値、質問版、重みから複数パラメータを計算すること", () => {
    const profile = scoreParameters(
      [answer("q-plan", 2, "yes"), answer("q-change", 1, "no")],
      CONFIG,
    );

    expect(profile).toEqual({
      scoringVersion: 3,
      parameters: [
        {
          id: "planning",
          label: "計画性",
          lowLabel: "即興を好む",
          highLabel: "計画を好む",
          score: 100,
          coverage: 100,
          band: "high",
        },
        {
          id: "flexibility",
          label: "柔軟性",
          lowLabel: "予定を守る",
          highLabel: "変更を楽しむ",
          score: 0,
          coverage: 100,
          band: "low",
        },
      ],
    });
  });

  it("設定したminimumCoverageに足りない軸だけを回答不足にすること", () => {
    const profile = scoreParameters([answer("q-plan", 2, "yes")], CONFIG);

    expect(profile.parameters).toEqual([
      expect.objectContaining({ id: "planning", score: null, coverage: 50, band: "insufficient" }),
      expect.objectContaining({
        id: "flexibility",
        score: null,
        coverage: 33,
        band: "insufficient",
      }),
    ]);
  });

  it("中立の選択値を回答済みとして数え、中央のスコアにすること", () => {
    const profile = scoreParameters(
      [answer("q-plan", 2, "neutral"), answer("q-change", 1, "neutral")],
      CONFIG,
    );

    expect(profile.parameters[0]).toMatchObject({ score: 50, coverage: 100, band: "balanced" });
    const parameter = profile.parameters[0];
    if (!parameter) {
      throw new Error("計画性パラメータがありません");
    }
    expect(getParameterSummary(parameter, CONFIG.balancedLabel)).toBe("状況による");
  });

  it("未知の質問・選択値と設定に一致しない質問版を除外すること", () => {
    const profile = scoreParameters(
      [
        answer("q-unknown", 1, "yes"),
        answer("q-plan", 1, "yes"),
        answer("q-change", 1, "unknown-choice"),
      ],
      CONFIG,
    );

    expect(
      profile.parameters.every(({ score, coverage }) => score === null && coverage === 0),
    ).toBe(true);
  });

  it("同じ質問への再回答では最後の選択を使うこと", () => {
    const profile = scoreParameters(
      [answer("q-plan", 2, "no"), answer("q-change", 1, "no"), answer("q-plan", 2, "yes")],
      CONFIG,
    );

    expect(profile.parameters[0]).toMatchObject({ score: 100, coverage: 100 });
  });

  it("同じ質問への最後の回答がスキップなら以前の選択を使わないこと", () => {
    const profile = scoreParameters(
      [
        answer("q-plan", 2, "yes"),
        {
          kind: "skipped",
          questionId: "q-plan",
          questionVersion: 2,
          answeredAt: "2026-08-02T00:01:00.000Z",
        },
      ],
      CONFIG,
    );

    expect(
      profile.parameters.every(({ score, coverage }) => score === null && coverage === 0),
    ).toBe(true);
  });

  it("不正な共通設定を受け付けないこと", () => {
    expect(() =>
      scoreParameters([], {
        ...CONFIG,
        minimumCoverage: 1.1,
      }),
    ).toThrow("minimumCoverageは0〜1にしてください");
  });

  it("未知のパラメータを参照する設定を受け付けないこと", () => {
    expect(() =>
      scoreParameters([], {
        ...CONFIG,
        questions: {
          "q-invalid": { questionVersion: 1, weights: { unknown: 1 } },
        },
      } as unknown as ParameterScoringConfig<TestParameterId>),
    ).toThrow("未知のparameter idです: unknown");
  });

  it("質問の重みがないパラメータを受け付けないこと", () => {
    expect(() =>
      scoreParameters([], {
        ...CONFIG,
        questions: {
          "q-plan": { questionVersion: 2, weights: { planning: 1 } },
        },
      }),
    ).toThrow("質問の重みがないparameter idです: flexibility");
  });
});
