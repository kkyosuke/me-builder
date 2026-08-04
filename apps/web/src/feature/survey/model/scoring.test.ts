import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
  type ParameterScoringConfig,
  ParameterScoringConfigSchema,
  getParameterSummary,
  scoreParameters,
} from "./scoring";
import type { SurveyAnswer, SurveyQuestion } from "./types";

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

const QUESTIONS: SurveyQuestion[] = [
  {
    surveyQuestionId: "sq-plan",
    questionId: "q-plan",
    questionVersion: 2,
    text: "計画を立てたい。",
    left: { choiceId: "no", label: "いいえ", icon: "circle-x" },
    right: { choiceId: "yes", label: "はい", icon: "circle-check" },
  },
  {
    surveyQuestionId: "sq-change",
    questionId: "q-change",
    questionVersion: 1,
    text: "予定の変更を楽しめる。",
    left: { choiceId: "no", label: "いいえ", icon: "circle-x" },
    right: { choiceId: "yes", label: "はい", icon: "circle-check" },
  },
];

function answer(questionId: string, questionVersion: number, choiceId: string): SurveyAnswer {
  return {
    kind: "answer",
    surveyQuestionId: questionId.replace(/^q-/, "sq-"),
    questionId,
    questionVersion,
    choiceId,
    direction: "right",
    acceptedAt: "2026-08-02T00:00:00.000Z",
  };
}

describe("scoreParameters", () => {
  it("設定した選択値、質問版、重みから複数パラメータを計算すること", () => {
    const profile = scoreParameters(
      [answer("q-plan", 2, "yes"), answer("q-change", 1, "no")],
      QUESTIONS,
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
    const profile = scoreParameters([answer("q-plan", 2, "yes")], QUESTIONS, CONFIG);

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
      QUESTIONS,
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
      QUESTIONS,
      CONFIG,
    );

    expect(
      profile.parameters.every(({ score, coverage }) => score === null && coverage === 0),
    ).toBe(true);
  });

  it("同じ質問への再回答では最後の選択を使うこと", () => {
    const profile = scoreParameters(
      [answer("q-plan", 2, "no"), answer("q-change", 1, "no"), answer("q-plan", 2, "yes")],
      QUESTIONS,
      CONFIG,
    );

    expect(profile.parameters[0]).toMatchObject({ score: 100, coverage: 100 });
  });

  it("延期を回答として計算しないこと", () => {
    const profile = scoreParameters(
      [
        {
          kind: "deferred",
          surveyQuestionId: "sq-plan",
          deferredAt: "2026-08-02T00:01:00.000Z",
        },
      ],
      QUESTIONS,
      CONFIG,
    );

    expect(
      profile.parameters.every(({ score, coverage }) => score === null && coverage === 0),
    ).toBe(true);
  });

  it("不正な共通設定を受け付けないこと", () => {
    expect(() =>
      scoreParameters([], QUESTIONS, {
        ...CONFIG,
        minimumCoverage: 1.1,
      }),
    ).toThrow("minimumCoverageは0〜1にしてください");
  });

  it("Valibotスキーマで有効な設定を検証できること", () => {
    expect(() => v.parse(ParameterScoringConfigSchema, CONFIG)).not.toThrow();
  });

  it("未知のパラメータを参照する設定を受け付けないこと", () => {
    expect(() =>
      scoreParameters([], QUESTIONS, {
        ...CONFIG,
        questions: {
          "q-invalid": { questionVersion: 1, weights: { unknown: 1 } },
        },
      } as unknown as ParameterScoringConfig<TestParameterId>),
    ).toThrow("questionsのweightsに未知のparameter idがあります");
  });

  it("質問の重みがないパラメータを受け付けないこと", () => {
    expect(() =>
      scoreParameters([], QUESTIONS, {
        ...CONFIG,
        questions: {
          "q-plan": { questionVersion: 2, weights: { planning: 1 } },
        },
      }),
    ).toThrow("質問の重みがないparameter idがあります");
  });

  it("質問定義と設定のQuestion IDが一致しなければ拒否すること", () => {
    expect(() =>
      scoreParameters(
        [],
        QUESTIONS.map((question) =>
          question.questionId === "q-plan" ? { ...question, questionId: "q-typo" } : question,
        ),
        CONFIG,
      ),
    ).toThrow("質問定義とスコアリング設定のQuestion IDが一致しません");
  });

  it("質問定義と設定のQuestion Versionが一致しなければ拒否すること", () => {
    expect(() =>
      scoreParameters(
        [],
        QUESTIONS.map((question) =>
          question.questionId === "q-plan" ? { ...question, questionVersion: 3 } : question,
        ),
        CONFIG,
      ),
    ).toThrow("質問定義とスコアリング設定のQuestion Versionが一致しません");
  });

  it("質問の選択値がchoiceScoresになければ拒否すること", () => {
    expect(() =>
      scoreParameters(
        [],
        QUESTIONS.map((question) =>
          question.questionId === "q-plan"
            ? { ...question, right: { ...question.right, choiceId: "unknown-choice" } }
            : question,
        ),
        CONFIG,
      ),
    ).toThrow("質問の選択値がchoiceScoresに定義されていません");
  });
});
