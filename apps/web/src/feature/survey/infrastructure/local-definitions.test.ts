import { describe, expect, it } from "vitest";
import { fetchSurveyDefinitions, fetchSurveyQuestions } from "./local-definitions";

describe("fetchSurveyQuestions", () => {
  it("質問を取得でき、Survey Question IDが重複していないこと", async () => {
    const questions = await fetchSurveyQuestions();

    expect(questions.length).toBeGreaterThan(0);
    expect(new Set(questions.map(({ surveyQuestionId }) => surveyQuestionId)).size).toBe(
      questions.length,
    );
  });

  it("すべての質問が左右 2 つの選択肢と版を持つこと", async () => {
    for (const question of await fetchSurveyQuestions()) {
      expect(question.text).not.toBe("");
      expect(question.questionVersion).toBeGreaterThanOrEqual(1);
      expect(question.left.choiceId).not.toBe(question.right.choiceId);
    }
  });
});

describe("fetchSurveyDefinitions", () => {
  it("2種類のアンケートを質問とスコア関数の組として取得できること", async () => {
    const surveys = await fetchSurveyDefinitions();

    expect(surveys.map(({ id }) => id)).toEqual(["relationship-priority", "money-values"]);
    for (const survey of surveys) {
      expect(survey.questions).toHaveLength(10);
      expect(() => survey.score([])).not.toThrow();
    }
  });
});
