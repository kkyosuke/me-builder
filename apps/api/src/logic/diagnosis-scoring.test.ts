import { describe, expect, it } from "vitest";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";

const CONFIG = {
  version: 3,
  definition: {
    parameters: [
      { id: "planning", label: "計画性", lowLabel: "即興", highLabel: "計画的" },
      { id: "flexibility", label: "柔軟性", lowLabel: "予定を守る", highLabel: "変更を楽しむ" },
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
  },
} as const;

const answer = (questionId: string, questionVersion: number, choiceId: string) => ({
  questionId,
  questionVersion,
  choiceId,
});

describe("scoreDiagnosisAnswers", () => {
  it("DBから取得した設定版と重みでプロフィールを計算する", () => {
    const scoring = scoreDiagnosisAnswers(
      [answer("q-plan", 2, "yes"), answer("q-change", 1, "no")],
      CONFIG,
    );

    expect(scoring).toEqual({
      scoringVersion: 3,
      balancedLabel: "状況による",
      parameters: [
        {
          id: "planning",
          label: "計画性",
          lowLabel: "即興",
          highLabel: "計画的",
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

  it("質問版や選択値が設定と一致しない回答を採点に含めない", () => {
    const scoring = scoreDiagnosisAnswers(
      [answer("q-plan", 1, "yes"), answer("q-change", 1, "unknown")],
      CONFIG,
    );

    expect(
      scoring?.parameters.every(({ score, coverage }) => score === null && coverage === 0),
    ).toBe(true);
  });

  it("同じ質問へ複数回答がある場合は最後の回答を現在値にする", () => {
    const scoring = scoreDiagnosisAnswers(
      [answer("q-plan", 2, "no"), answer("q-change", 1, "no"), answer("q-plan", 2, "yes")],
      CONFIG,
    );

    expect(scoring?.parameters[0]).toMatchObject({ score: 100, coverage: 100 });
  });

  it("採点設定がない診断はnullを返す", () => {
    expect(scoreDiagnosisAnswers([answer("q-plan", 2, "yes")], null)).toBeNull();
  });

  it("DB上の採点設定が不正なら拒否する", () => {
    expect(() =>
      scoreDiagnosisAnswers([], {
        ...CONFIG,
        definition: { ...CONFIG.definition, minimumCoverage: 2 },
      }),
    ).toThrow();
  });
});
