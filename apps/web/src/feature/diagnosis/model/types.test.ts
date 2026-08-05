import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { DiagnosisAnswerSchema, DiagnosisQuestionSchema } from "./types";

describe("DiagnosisQuestionSchema", () => {
  it("左右が同じChoice IDの質問を拒否する", () => {
    expect(() =>
      v.parse(DiagnosisQuestionSchema, {
        diagnosisQuestionId: "diagnosis-question-1",
        questionId: "question-1",
        questionVersion: 1,
        text: "どちらですか？",
        left: { choiceId: "same", label: "左" },
        right: { choiceId: "same", label: "右" },
      }),
    ).toThrow(/Choice ID/);
  });
});

describe("DiagnosisAnswerSchema", () => {
  it("不正な回答日時を拒否する", () => {
    expect(() =>
      v.parse(DiagnosisAnswerSchema, {
        kind: "answer",
        diagnosisQuestionId: "diagnosis-question-1",
        questionId: "question-1",
        questionVersion: 1,
        choiceId: "yes",
        direction: "right",
        acceptedAt: "not-a-date",
      }),
    ).toThrow();
  });
});
