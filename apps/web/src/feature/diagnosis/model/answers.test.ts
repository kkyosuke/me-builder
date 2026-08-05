import { describe, expect, it } from "vitest";
import {
  createDeferredQuestion,
  createDiagnosisAnswer,
  restoreDiagnosisProgress,
  summarizeInteractions,
} from "./answers";
import type { DiagnosisQuestion } from "./types";

const QUESTION: DiagnosisQuestion = {
  diagnosisQuestionId: "dq-test",
  questionId: "q-test",
  questionVersion: 3,
  text: "テストの質問",
  left: { choiceId: "left-value", label: "左", icon: "house" },
  right: { choiceId: "right-value", label: "右", icon: "mountain" },
};

const ANSWERED_AT = new Date("2026-07-28T00:00:00.000Z");

describe("createDiagnosisAnswer", () => {
  it("左右それぞれの選択肢のChoice IDを記録すること", () => {
    expect(createDiagnosisAnswer(QUESTION, "left", ANSWERED_AT)).toEqual({
      kind: "answer",
      diagnosisQuestionId: "dq-test",
      questionId: "q-test",
      questionVersion: 3,
      choiceId: "left-value",
      direction: "left",
      acceptedAt: "2026-07-28T00:00:00.000Z",
    });
    expect(createDiagnosisAnswer(QUESTION, "right", ANSWERED_AT)).toMatchObject({
      choiceId: "right-value",
      direction: "right",
    });
  });

  it("回答した時点の質問の版を持つこと", () => {
    // 公開済みの質問文は書き換えず、改訂は新しい版として追加される
    expect(createDiagnosisAnswer(QUESTION, "left", ANSWERED_AT).questionVersion).toBe(
      QUESTION.questionVersion,
    );
  });
});

describe("createDeferredQuestion", () => {
  it("あとで回答を回答内容と区別できる形で記録すること", () => {
    const deferred = createDeferredQuestion(QUESTION, ANSWERED_AT);

    expect(deferred).toEqual({
      kind: "deferred",
      diagnosisQuestionId: "dq-test",
      deferredAt: "2026-07-28T00:00:00.000Z",
    });
    expect(deferred).not.toHaveProperty("choiceId");
  });
});

describe("summarizeInteractions", () => {
  it("回答と延期の件数を分けて数えること", () => {
    const interactions = [
      createDiagnosisAnswer(QUESTION, "left", ANSWERED_AT),
      createDeferredQuestion(QUESTION, ANSWERED_AT),
      createDiagnosisAnswer(QUESTION, "right", ANSWERED_AT),
    ];

    expect(summarizeInteractions(interactions)).toEqual({ answered: 2, deferred: 1 });
  });

  it("1 問も回答していなければ 0 件になること", () => {
    expect(summarizeInteractions([])).toEqual({ answered: 0, deferred: 0 });
  });
});

describe("restoreDiagnosisProgress", () => {
  const SECOND_QUESTION: DiagnosisQuestion = {
    ...QUESTION,
    diagnosisQuestionId: "dq-second",
    questionId: "q-second",
    text: "2問目",
  };

  it("保存済み回答を復元し、最初の未回答を含む質問だけを表示順で返す", () => {
    const restored = restoreDiagnosisProgress(
      [QUESTION, SECOND_QUESTION],
      [
        {
          diagnosisQuestionId: QUESTION.diagnosisQuestionId,
          questionId: QUESTION.questionId,
          questionVersion: QUESTION.questionVersion,
          questionText: QUESTION.text,
          choiceId: QUESTION.right.choiceId,
          choiceLabel: QUESTION.right.label,
          acceptedAt: ANSWERED_AT.toISOString(),
        },
      ],
    );

    expect(restored.answers).toEqual([
      expect.objectContaining({
        diagnosisQuestionId: "dq-test",
        choiceId: "right-value",
        direction: "right",
      }),
    ]);
    expect(restored.unansweredQuestions).toEqual([SECOND_QUESTION]);
  });

  it("配信中の質問に存在しない保存済み回答は復元しない", () => {
    expect(() =>
      restoreDiagnosisProgress(
        [QUESTION],
        [
          {
            diagnosisQuestionId: "dq-unknown",
            questionId: "q-unknown",
            questionVersion: 1,
            questionText: "不明な質問",
            choiceId: "yes",
            choiceLabel: "はい",
            acceptedAt: ANSWERED_AT.toISOString(),
          },
        ],
      ),
    ).toThrow("配信対象外");
  });
});
