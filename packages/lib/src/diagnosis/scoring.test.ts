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
          evidenceCount: 2,
          band: "high",
        },
        {
          id: "flexibility",
          label: "柔軟性",
          lowLabel: "予定を守る",
          highLabel: "変更を楽しむ",
          score: 0,
          coverage: 100,
          evidenceCount: 2,
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

    expect(scoring?.parameters[0]).toMatchObject({ score: 100, coverage: 100, evidenceCount: 2 });
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
});
