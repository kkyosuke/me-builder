import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
  CreateSurveyInputSchema,
  QuestionVersionContentSchema,
  SurveyResponseSchema,
} from "./schema";

describe("Questionnaire Valibot schemas", () => {
  it("Question VersionのChoice ID重複を拒否する", () => {
    const result = v.safeParse(QuestionVersionContentSchema, {
      text: "質問",
      choices: [
        { id: "same", label: "A" },
        { id: "same", label: "B" },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("Surveyの期間とQuestion重複を検証する", () => {
    const result = v.safeParse(CreateSurveyInputSchema, {
      id: "survey-1",
      title: "アンケート",
      description: "アンケートの説明",
      opensAt: new Date("2026-08-02T00:00:00Z"),
      closesAt: new Date("2026-08-01T00:00:00Z"),
      questions: [
        { id: "sq-1", questionId: "q1", questionVersion: 1 },
        { id: "sq-2", questionId: "q1", questionVersion: 2 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("Survey Questionごとの現在回答を1件に制限する", () => {
    const answer = {
      surveyQuestionId: "sq-1",
      questionId: "q1",
      questionVersion: 1,
      choiceId: "left",
      acceptedAt: "2026-08-01T00:00:00.000Z",
      sourceRecordId: "source-1",
    };
    const result = v.safeParse(SurveyResponseSchema, {
      id: "response-1",
      accountId: "account-1",
      surveyId: "survey-1",
      answers: [answer, { ...answer, sourceRecordId: "source-2" }],
      deferredQuestions: [],
    });

    expect(result.success).toBe(false);
  });
});
