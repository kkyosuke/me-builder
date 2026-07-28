import { describe, expect, it } from "vitest";
import { createChoiceAnswer, createSkipAnswer, summarizeAnswers } from "./answers";
import { fetchSurveyQuestions } from "./questions";
import type { SurveyQuestion } from "./types";

const QUESTION: SurveyQuestion = {
  id: "q-test",
  version: 3,
  text: "テストの質問",
  left: { value: "left-value", label: "左", icon: "house" },
  right: { value: "right-value", label: "右", icon: "mountain" },
};

const ANSWERED_AT = new Date("2026-07-28T00:00:00.000Z");

describe("createChoiceAnswer", () => {
  it("左右それぞれの選択肢の value を記録すること", () => {
    expect(createChoiceAnswer(QUESTION, "left", ANSWERED_AT)).toEqual({
      kind: "choice",
      questionId: "q-test",
      questionVersion: 3,
      value: "left-value",
      direction: "left",
      answeredAt: "2026-07-28T00:00:00.000Z",
    });
    expect(createChoiceAnswer(QUESTION, "right", ANSWERED_AT)).toMatchObject({
      value: "right-value",
      direction: "right",
    });
  });

  it("回答した時点の質問の版を持つこと", () => {
    // 公開済みの質問文は書き換えず、改訂は新しい版として追加される
    expect(createChoiceAnswer(QUESTION, "left", ANSWERED_AT).questionVersion).toBe(
      QUESTION.version,
    );
  });
});

describe("createSkipAnswer", () => {
  it("スキップを選択と区別できる形で記録すること", () => {
    const answer = createSkipAnswer(QUESTION, ANSWERED_AT);

    expect(answer).toEqual({
      kind: "skipped",
      questionId: "q-test",
      questionVersion: 3,
      answeredAt: "2026-07-28T00:00:00.000Z",
    });
    expect(answer).not.toHaveProperty("value");
  });
});

describe("summarizeAnswers", () => {
  it("回答とスキップの件数を分けて数えること", () => {
    const answers = [
      createChoiceAnswer(QUESTION, "left", ANSWERED_AT),
      createSkipAnswer(QUESTION, ANSWERED_AT),
      createChoiceAnswer(QUESTION, "right", ANSWERED_AT),
    ];

    expect(summarizeAnswers(answers)).toEqual({ answered: 2, skipped: 1 });
  });

  it("1 問も回答していなければ 0 件になること", () => {
    expect(summarizeAnswers([])).toEqual({ answered: 0, skipped: 0 });
  });
});

describe("fetchSurveyQuestions", () => {
  it("質問を取得でき、id が重複していないこと", async () => {
    const questions = await fetchSurveyQuestions();

    expect(questions.length).toBeGreaterThan(0);
    expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
  });

  it("すべての質問が左右 2 つの選択肢と版を持つこと", async () => {
    for (const question of await fetchSurveyQuestions()) {
      expect(question.text).not.toBe("");
      expect(question.version).toBeGreaterThanOrEqual(1);
      expect(question.left.value).not.toBe(question.right.value);
    }
  });
});
