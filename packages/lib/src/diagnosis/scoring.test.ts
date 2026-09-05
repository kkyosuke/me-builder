import { describe, expect, it } from "vitest";
import { projectDiagnosisParameters, scoreDiagnosisAnswers } from "./scoring";

const CONFIG = {
  version: 3,
  questions: [
    { questionId: "q-plan", questionVersion: 2, choiceIds: ["yes", "neutral", "no"] },
    { questionId: "q-change", questionVersion: 1, choiceIds: ["yes", "neutral", "no"] },
  ],
  definition: {
    parameters: [
      {
        id: "planning",
        label: "計画性",
        lowLabel: "即興",
        highLabel: "計画的",
        relationshipRequests: {
          high: "予定を早めに相談してもらえるとうれしいです。",
        },
      },
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

const PAIRED_CONFIG = {
  version: 4,
  questions: [
    {
      diagnosisQuestionId: "diagnosis-question-behavior",
      questionId: "q-family-behavior",
      questionVersion: 1,
      choiceIds: ["yes", "no"],
      backsideOfDiagnosisQuestionId: null,
    },
    {
      diagnosisQuestionId: "diagnosis-question-desired",
      questionId: "q-family-desired",
      questionVersion: 1,
      choiceIds: ["yes", "no"],
      backsideOfDiagnosisQuestionId: "diagnosis-question-behavior",
    },
  ],
  definition: {
    parameters: [
      {
        id: "family_time",
        label: "家族との時間",
        lowLabel: "自分の時間を優先する",
        highLabel: "家族との時間を優先する",
      },
    ],
    choiceScores: { yes: 1, no: -1 },
    questions: {
      "q-family-behavior": { questionVersion: 1, weights: { family_time: 1 } },
      "q-family-desired": { questionVersion: 1, weights: { family_time: 1 } },
    },
    minimumCoverage: 1,
    lowMaximum: 35,
    highMinimum: 65,
    balancedLabel: "どちらもある",
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
          resultKind: "aggregate",
          score: 100,
          coverage: 100,
          band: "high",
          behavior: null,
          comparison: null,
          relationshipRequest: "予定を早めに相談してもらえるとうれしいです。",
        },
        {
          id: "flexibility",
          label: "柔軟性",
          lowLabel: "予定を守る",
          highLabel: "変更を楽しむ",
          resultKind: "aggregate",
          score: 0,
          coverage: 100,
          band: "low",
          behavior: null,
          comparison: null,
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

  it("表裏質問を普段の行動と大切にしたいことへ分けて同じParameter上で採点する", () => {
    const scoring = scoreDiagnosisAnswers(
      [answer("q-family-behavior", 1, "no"), answer("q-family-desired", 1, "yes")],
      PAIRED_CONFIG,
    );

    expect(scoring?.parameters[0]).toEqual({
      id: "family_time",
      label: "家族との時間",
      lowLabel: "自分の時間を優先する",
      highLabel: "家族との時間を優先する",
      resultKind: "behavior_desired",
      score: 100,
      coverage: 100,
      band: "high",
      behavior: { score: 0, coverage: 100, band: "low" },
      comparison: { difference: 100, relation: "desired_higher" },
    });
  });

  it("普段の行動の方が高い場合も望みを主スコアにして向きを返す", () => {
    const scoring = scoreDiagnosisAnswers(
      [answer("q-family-behavior", 1, "yes"), answer("q-family-desired", 1, "no")],
      PAIRED_CONFIG,
    );

    expect(scoring?.parameters[0]).toMatchObject({
      score: 0,
      behavior: { score: 100 },
      comparison: { difference: -100, relation: "behavior_higher" },
    });
  });

  it("普段の行動と望みが同じ帯域なら同じ傾向の範囲として返す", () => {
    const scoring = scoreDiagnosisAnswers(
      [answer("q-family-behavior", 1, "yes"), answer("q-family-desired", 1, "yes")],
      PAIRED_CONFIG,
    );

    expect(scoring?.parameters[0]).toMatchObject({
      score: 100,
      behavior: { score: 100 },
      comparison: { difference: 0, relation: "same_band" },
    });
  });

  it("表裏の片方が回答不足なら比較しない", () => {
    const scoring = scoreDiagnosisAnswers([answer("q-family-behavior", 1, "yes")], PAIRED_CONFIG);

    expect(scoring?.parameters[0]).toMatchObject({
      score: null,
      behavior: { score: 100 },
      comparison: null,
    });
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

  it("空の関わり方文設定を拒否する", () => {
    expect(() =>
      scoreDiagnosisAnswers([], {
        ...CONFIG,
        definition: {
          ...CONFIG.definition,
          parameters: CONFIG.definition.parameters.map((parameter) => ({
            ...parameter,
            relationshipRequests: {},
          })),
        },
      }),
    ).toThrow();
  });

  it.each([
    {
      name: "Question IDに過不足がある",
      questions: CONFIG.questions.slice(0, 1),
    },
    {
      name: "Question Versionが異なる",
      questions: CONFIG.questions.map((question) =>
        question.questionId === "q-plan" ? { ...question, questionVersion: 1 } : question,
      ),
    },
    {
      name: "選択値がchoiceScoresにない",
      questions: CONFIG.questions.map((question) =>
        question.questionId === "q-plan"
          ? { ...question, choiceIds: [...question.choiceIds, "unknown"] }
          : question,
      ),
    },
  ])("質問定義と一致しない採点設定を拒否する: $name", ({ questions }) => {
    expect(() => scoreDiagnosisAnswers([], { ...CONFIG, questions })).toThrow();
  });

  it("表裏質問の寄与先や重みが一致しない採点設定を拒否する", () => {
    expect(() =>
      scoreDiagnosisAnswers([], {
        ...PAIRED_CONFIG,
        definition: {
          ...PAIRED_CONFIG.definition,
          questions: {
            ...PAIRED_CONFIG.definition.questions,
            "q-family-desired": { questionVersion: 1, weights: { family_time: -1 } },
          },
        },
      }),
    ).toThrow();
  });

  it("同じParameterへ表裏質問と独立質問を混在させた設定を拒否する", () => {
    expect(() =>
      scoreDiagnosisAnswers([], {
        ...PAIRED_CONFIG,
        questions: [
          ...PAIRED_CONFIG.questions,
          { questionId: "q-single", questionVersion: 1, choiceIds: ["yes", "no"] },
        ],
        definition: {
          ...PAIRED_CONFIG.definition,
          questions: {
            ...PAIRED_CONFIG.definition.questions,
            "q-single": { questionVersion: 1, weights: { family_time: 1 } },
          },
        },
      }),
    ).toThrow();
  });
});

describe("projectDiagnosisParameters", () => {
  it("パラメータごとにstatementと寄与したSource Recordを組み立てる", () => {
    const projections = projectDiagnosisParameters({
      diagnosisId: "diagnosis-1",
      scoringConfigId: "scoring-1",
      answers: [
        { ...answer("q-plan", 2, "yes"), sourceRecordId: "source-plan" },
        { ...answer("q-change", 1, "no"), sourceRecordId: "source-change" },
      ],
      storedConfig: CONFIG,
    });

    expect(projections).toEqual([
      expect.objectContaining({
        parameterId: "planning",
        perspective: "aggregate",
        category: "preference",
        statement: "計画性は「計画的」の傾向がある",
        attributes: {
          diagnosisId: "diagnosis-1",
          scoringConfigId: "scoring-1",
          scoringVersion: 3,
          parameterId: "planning",
          score: 100,
          coverage: 100,
          band: "high",
        },
        evidenceSourceRecordIds: ["source-change", "source-plan"],
      }),
      expect.objectContaining({
        parameterId: "flexibility",
        statement: "柔軟性は「予定を守る」の傾向がある",
        evidenceSourceRecordIds: ["source-change", "source-plan"],
      }),
    ]);
  });

  it("回答不足のパラメータはprojectionしない", () => {
    expect(
      projectDiagnosisParameters({
        diagnosisId: "diagnosis-1",
        scoringConfigId: "scoring-1",
        answers: [{ ...answer("q-plan", 1, "yes"), sourceRecordId: "source-plan" }],
        storedConfig: CONFIG,
      }),
    ).toEqual([]);
  });

  it("表裏の結果をBehavior PatternとPreferenceへ別々にprojectionする", () => {
    const projections = projectDiagnosisParameters({
      diagnosisId: "diagnosis-1",
      scoringConfigId: "scoring-1",
      answers: [
        {
          ...answer("q-family-behavior", 1, "no"),
          sourceRecordId: "source-behavior",
        },
        { ...answer("q-family-desired", 1, "yes"), sourceRecordId: "source-desired" },
      ],
      storedConfig: PAIRED_CONFIG,
    });

    expect(projections).toEqual([
      expect.objectContaining({
        parameterId: "family_time",
        perspective: "behavior",
        category: "behavior_pattern",
        statement: "家族との時間の普段の行動は「自分の時間を優先する」の傾向がある",
        attributes: expect.objectContaining({ perspective: "behavior", score: 0 }),
        evidenceSourceRecordIds: ["source-behavior"],
      }),
      expect.objectContaining({
        parameterId: "family_time",
        perspective: "desired",
        category: "preference",
        statement: "家族との時間で大切にしたいことは「家族との時間を優先する」の傾向がある",
        attributes: expect.objectContaining({ perspective: "desired", score: 100 }),
        evidenceSourceRecordIds: ["source-desired"],
      }),
    ]);
  });
});
