import type { sharedD1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { deferDiagnosisQuestion } from "./diagnosis-deferred-question";

const db = {} as sharedD1.Client;
const at = new Date("2026-08-06T00:00:00.000Z");

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
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        at,
      },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
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

  it("本人確認できない場合はD1へ書き込まない", async () => {
    const deferQuestion = vi.fn();
    const session = { type: "unauthenticated" as const, reason: "invalid" };
    const result = await deferDiagnosisQuestion(
      {
        diagnosisId: "diagnosis-1",
        diagnosisQuestionId: "dq-1",
        idToken: undefined,
        lineLoginChannelId: "channel",
        db,
        at,
      },
      { createSession: vi.fn().mockResolvedValue(session), deferQuestion },
    );

    expect(result).toEqual(session);
    expect(deferQuestion).not.toHaveBeenCalled();
  });
});
