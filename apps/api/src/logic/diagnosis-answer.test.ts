import { describe, expect, it, vi } from "vitest";
import { saveDiagnosisAnswer } from "./diagnosis-answer";

const at = new Date("2026-08-05T00:00:00.000Z");
const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: at,
};

describe("saveDiagnosisAnswer", () => {
  it("検証済みAccount IDだけをD1 actionへ渡す", async () => {
    const saved = {
      type: "saved" as const,
      outcome: "created" as const,
      answer: {
        diagnosisQuestionId: "dq-1",
        questionId: "q-1",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: at.toISOString(),
      },
      progress: {
        responseStatus: "in-progress" as const,
        answeredCount: 1,
        questionCount: 2,
      },
    };
    const saveAnswer = vi.fn().mockResolvedValue(saved);
    const result = await saveDiagnosisAnswer(
      {
        diagnosisId: "diagnosis-1",
        diagnosisQuestionId: "dq-1",
        choiceId: "yes",
        actor,
        at,
      },
      {
        saveAnswer,
      },
    );
    expect(saveAnswer).toHaveBeenCalledWith(undefined, "account-1", {
      diagnosisId: "diagnosis-1",
      diagnosisQuestionId: "dq-1",
      choiceId: "yes",
      at,
    });
    expect(result).toEqual(saved);
  });

  it("全問回答済みになったときprojection要求をbest-effortで処理する", async () => {
    const scheduleProjection = vi.fn((task: () => Promise<void>) => void task());
    const processLatestProjection = vi.fn().mockResolvedValue({
      processed: 1,
      applied: 1,
      skippedIncomplete: 0,
      skippedInvalidConfig: 0,
      failed: 0,
    });
    const saved = {
      type: "saved" as const,
      outcome: "created" as const,
      answer: {
        diagnosisQuestionId: "dq-2",
        questionId: "q-2",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: at.toISOString(),
      },
      progress: {
        responseStatus: "answered" as const,
        answeredCount: 2,
        questionCount: 2,
      },
    };

    await saveDiagnosisAnswer(
      {
        diagnosisId: "diagnosis-1",
        diagnosisQuestionId: "dq-2",
        choiceId: "yes",
        actor,
        at,
        scheduleProjection,
      },
      {
        saveAnswer: vi.fn().mockResolvedValue(saved),
        processLatestProjection,
      },
    );

    expect(processLatestProjection).toHaveBeenCalledWith(undefined, "account-1", "diagnosis-1", at);
    expect(scheduleProjection).toHaveBeenCalledOnce();
  });
});
