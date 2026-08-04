import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { SurveyAnswerSchema, SurveyQuestionSchema } from "./types";

describe("SurveyQuestionSchema", () => {
  it("左右が同じChoice IDの質問を拒否する", () => {
    expect(() =>
      v.parse(SurveyQuestionSchema, {
        surveyQuestionId: "survey-question-1",
        questionId: "question-1",
        questionVersion: 1,
        text: "どちらですか？",
        left: { choiceId: "same", label: "左", icon: "house" },
        right: { choiceId: "same", label: "右", icon: "mountain" },
      }),
    ).toThrow(/Choice ID/);
  });
});

describe("SurveyAnswerSchema", () => {
  it("不正な回答日時を拒否する", () => {
    expect(() =>
      v.parse(SurveyAnswerSchema, {
        kind: "answer",
        surveyQuestionId: "survey-question-1",
        questionId: "question-1",
        questionVersion: 1,
        choiceId: "yes",
        direction: "right",
        acceptedAt: "not-a-date",
      }),
    ).toThrow();
  });
});
