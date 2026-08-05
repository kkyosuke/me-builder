import { describe, expect, it } from "vitest";
import type { DiagnosisAnswer } from "../types";
import {
  MONEY_VALUES_QUESTIONS,
  MONEY_VALUES_SCORING_CONFIG,
  scoreMoneyValues,
} from "./money-values";

function answer(questionNumber: number, value: "yes" | "no"): DiagnosisAnswer {
  return {
    kind: "answer",
    diagnosisQuestionId: `dq-money-${String(questionNumber).padStart(2, "0")}`,
    questionId: `q-money-${String(questionNumber).padStart(2, "0")}`,
    questionVersion: 1,
    choiceId: value,
    direction: value === "yes" ? "right" : "left",
    acceptedAt: "2026-08-03T00:00:00.000Z",
  };
}

describe("MONEY_VALUES_QUESTIONS", () => {
  it("version 1のYes／No質問を10問持つこと", () => {
    expect(MONEY_VALUES_QUESTIONS).toHaveLength(10);
    expect(
      new Set(MONEY_VALUES_QUESTIONS.map(({ diagnosisQuestionId }) => diagnosisQuestionId)).size,
    ).toBe(10);

    for (const question of MONEY_VALUES_QUESTIONS) {
      expect(question.questionVersion).toBe(1);
      expect(question.left.choiceId).toBe("no");
      expect(question.right.choiceId).toBe("yes");
    }
  });
});

describe("scoreMoneyValues", () => {
  it("全問Yesを5つの独立したパラメータへ変換すること", () => {
    const profile = scoreMoneyValues(
      MONEY_VALUES_QUESTIONS.map((_, index) => answer(index + 1, "yes")),
    );

    expect(profile).toEqual({
      scoringVersion: 1,
      parameters: [
        expect.objectContaining({ id: "future-preparation", score: 50, coverage: 100 }),
        expect.objectContaining({ id: "financial-sharing", score: 67, coverage: 100 }),
        expect.objectContaining({ id: "fairness-flexibility", score: 50, coverage: 100 }),
        expect.objectContaining({ id: "durable-value", score: 40, coverage: 100 }),
        expect.objectContaining({ id: "risk-tolerance", score: 75, coverage: 100 }),
      ],
    });
  });

  it("将来への備えを一貫して選ぶと100になること", () => {
    const profile = scoreMoneyValues([
      answer(1, "yes"),
      answer(2, "no"),
      answer(5, "yes"),
      answer(6, "no"),
    ]);

    expect(profile.parameters[0]).toMatchObject({
      id: "future-preparation",
      score: 100,
      coverage: 100,
      band: "high",
    });
  });

  it("個人の裁量を一貫して選ぶとお金の共有が低い側になること", () => {
    const profile = scoreMoneyValues([answer(3, "no"), answer(7, "no"), answer(10, "yes")]);

    expect(profile.parameters[1]).toMatchObject({
      id: "financial-sharing",
      score: 0,
      coverage: 100,
      band: "low",
    });
  });

  it("回答充足率が足りない軸は回答不足にすること", () => {
    const profile = scoreMoneyValues([answer(8, "yes")]);
    const riskTolerance = profile.parameters.find(({ id }) => id === "risk-tolerance");

    expect(riskTolerance).toMatchObject({ score: null, coverage: 50, band: "insufficient" });
  });

  it("質問定義とスコア設定が共通バリデーションを通ること", () => {
    expect(() => scoreMoneyValues([])).not.toThrow();
    expect(MONEY_VALUES_SCORING_CONFIG.version).toBe(1);
  });
});
