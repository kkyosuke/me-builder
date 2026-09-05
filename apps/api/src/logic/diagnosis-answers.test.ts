import { describe, expect, it, vi } from "vitest";
import { getDiagnosisAnswers } from "./diagnosis-answers";

const at = new Date("2026-08-05T00:00:00.000Z");
const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: at,
};

describe("getDiagnosisAnswers", () => {
  it("本人確認で解決したAccountの回答を取得する", async () => {
    const diagnosis = {
      id: "diagnosis-1",
      title: "タイトル",
      description: "説明",
      responseStatus: "answered" as const,
      answeredCount: 1,
      questionCount: 1,
      scoringConfig: null,
      answers: [],
    };
    const findAnswers = vi.fn().mockResolvedValue({ type: "found", diagnosis });

    const result = await getDiagnosisAnswers(
      { diagnosisId: "diagnosis-1", actor, at },
      {
        findAnswers,
      },
    );

    expect(findAnswers).toHaveBeenCalledWith(undefined, "account-1", "diagnosis-1", at);
    const { scoringConfig: _, ...expectedDiagnosis } = diagnosis;
    expect(result).toEqual({
      type: "resolved",
      diagnosis: { ...expectedDiagnosis, scoring: null },
    });
  });

  it("回答がない場合はdiagnosis-answers-not-foundへ変換する", async () => {
    const result = await getDiagnosisAnswers(
      { diagnosisId: "diagnosis-1", actor, at },
      {
        findAnswers: vi.fn().mockResolvedValue({ type: "not-found" }),
      },
    );
    expect(result).toEqual({ type: "diagnosis-answers-not-found" });
  });

  it("回答途中では採点せず保存済み回答だけを返す", async () => {
    const diagnosis = {
      id: "diagnosis-1",
      title: "タイトル",
      description: "説明",
      responseStatus: "in-progress" as const,
      answeredCount: 1,
      questionCount: 2,
      scoringConfig: {
        id: "invalid-config",
        version: 1,
        definition: {},
        questions: [],
      },
      answers: [
        {
          diagnosisQuestionId: "dq-1",
          questionId: "q-1",
          questionVersion: 1,
          questionText: "質問",
          choiceId: "yes",
          choiceLabel: "はい",
          acceptedAt: "2026-08-05T00:00:00.000Z",
          perspective: "single" as const,
          pairId: null,
        },
      ],
    };

    const result = await getDiagnosisAnswers(
      { diagnosisId: "diagnosis-1", actor, at },
      {
        findAnswers: vi.fn().mockResolvedValue({ type: "found", diagnosis }),
      },
    );

    const { scoringConfig: _, ...expectedDiagnosis } = diagnosis;
    expect(result).toEqual({
      type: "resolved",
      diagnosis: { ...expectedDiagnosis, scoring: null },
    });
  });
});
