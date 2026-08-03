import { describe, expect, it } from "vitest";
import { createDeferredQuestion, createSurveyAnswer, summarizeInteractions } from "./answers";
import { fetchSurveyDefinitions, fetchSurveyQuestions } from "./questions";
import type { SurveyQuestion } from "./types";

const QUESTION: SurveyQuestion = {
  surveyQuestionId: "sq-test",
  questionId: "q-test",
  questionVersion: 3,
  text: "テストの質問",
  left: { choiceId: "left-value", label: "左", icon: "house" },
  right: { choiceId: "right-value", label: "右", icon: "mountain" },
};

const ANSWERED_AT = new Date("2026-07-28T00:00:00.000Z");

describe("createSurveyAnswer", () => {
  it("左右それぞれの選択肢のChoice IDを記録すること", () => {
    expect(createSurveyAnswer(QUESTION, "left", ANSWERED_AT)).toEqual({
      kind: "answer",
      surveyQuestionId: "sq-test",
      questionId: "q-test",
      questionVersion: 3,
      choiceId: "left-value",
      direction: "left",
      acceptedAt: "2026-07-28T00:00:00.000Z",
    });
    expect(createSurveyAnswer(QUESTION, "right", ANSWERED_AT)).toMatchObject({
      choiceId: "right-value",
      direction: "right",
    });
  });

  it("回答した時点の質問の版を持つこと", () => {
    // 公開済みの質問文は書き換えず、改訂は新しい版として追加される
    expect(createSurveyAnswer(QUESTION, "left", ANSWERED_AT).questionVersion).toBe(
      QUESTION.questionVersion,
    );
  });
});

describe("createDeferredQuestion", () => {
  it("あとで回答を回答内容と区別できる形で記録すること", () => {
    const deferred = createDeferredQuestion(QUESTION, ANSWERED_AT);

    expect(deferred).toEqual({
      kind: "deferred",
      surveyQuestionId: "sq-test",
      deferredAt: "2026-07-28T00:00:00.000Z",
    });
    expect(deferred).not.toHaveProperty("choiceId");
  });
});

describe("summarizeInteractions", () => {
  it("回答と延期の件数を分けて数えること", () => {
    const interactions = [
      createSurveyAnswer(QUESTION, "left", ANSWERED_AT),
      createDeferredQuestion(QUESTION, ANSWERED_AT),
      createSurveyAnswer(QUESTION, "right", ANSWERED_AT),
    ];

    expect(summarizeInteractions(interactions)).toEqual({ answered: 2, deferred: 1 });
  });

  it("1 問も回答していなければ 0 件になること", () => {
    expect(summarizeInteractions([])).toEqual({ answered: 0, deferred: 0 });
  });
});

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
