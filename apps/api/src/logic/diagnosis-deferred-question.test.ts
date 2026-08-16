import { describe, expect, it, vi } from "vitest";
import { deferDiagnosisQuestion } from "./diagnosis-deferred-question";

const at = new Date("2026-08-06T00:00:00.000Z");
const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: at,
};

describe("deferDiagnosisQuestion", () => {
  it("検証済みAccount IDだけをD1 actionへ渡す", async () => {
    const deferred = {
      type: "deferred" as const,
      outcome: "created" as const,
      deferredQuestion: { diagnosisQuestionId: "dq-1", deferredAt: at.toISOString() },
    };
    const deferQuestion = vi.fn().mockResolvedValue(deferred);
    const result = await deferDiagnosisQuestion(
      {
        diagnosisId: "diagnosis-1",
        diagnosisQuestionId: "dq-1",
        actor,
        at,
      },
      {
        deferQuestion,
      },
    );

    expect(deferQuestion).toHaveBeenCalledWith(undefined, "account-1", {
      diagnosisId: "diagnosis-1",
      diagnosisQuestionId: "dq-1",
      at,
    });
    expect(result).toEqual(deferred);
  });
});
