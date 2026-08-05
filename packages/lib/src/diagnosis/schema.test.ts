import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
  CreateDiagnosisInputSchema,
  DiagnosisResponseSchema,
  QuestionVersionContentSchema,
} from "./schema";

describe("Diagnosis Valibot schemas", () => {
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

  it("Diagnosisの期間とQuestion重複を検証する", () => {
    const result = v.safeParse(CreateDiagnosisInputSchema, {
      id: "diagnosis-1",
      title: "診断",
      description: "診断の説明",
      opensAt: new Date("2026-08-02T00:00:00Z"),
      closesAt: new Date("2026-08-01T00:00:00Z"),
      questions: [
        { id: "dq-1", questionId: "q1", questionVersion: 1 },
        { id: "dq-2", questionId: "q1", questionVersion: 2 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("Diagnosis Questionごとの現在回答を1件に制限する", () => {
    const answer = {
      diagnosisQuestionId: "dq-1",
      questionId: "q1",
      questionVersion: 1,
      choiceId: "left",
      acceptedAt: "2026-08-01T00:00:00.000Z",
      sourceRecordId: "source-1",
    };
    const result = v.safeParse(DiagnosisResponseSchema, {
      id: "response-1",
      accountId: "account-1",
      diagnosisId: "diagnosis-1",
      answers: [answer, { ...answer, sourceRecordId: "source-2" }],
      deferredQuestions: [],
    });

    expect(result.success).toBe(false);
  });
});
