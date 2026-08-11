import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { saveDiagnosisAnswer } from "./diagnosis-answer";

const db = {} as D1.shared.Client;
const at = new Date("2026-08-05T00:00:00.000Z");

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

  it("本人確認できない場合はD1へ書き込まない", async () => {
    const saveAnswer = vi.fn();
    const session = { type: "unauthenticated" as const, reason: "invalid" };
    const result = await saveDiagnosisAnswer(
      {
        diagnosisId: "diagnosis-1",
        diagnosisQuestionId: "dq-1",
        choiceId: "yes",
        idToken: undefined,
        lineLoginChannelId: "channel",
        db,
        at,
      },
      { createSession: vi.fn().mockResolvedValue(session), saveAnswer },
    );
    expect(result).toEqual(session);
    expect(saveAnswer).not.toHaveBeenCalled();
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
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        at,
        scheduleProjection,
      },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
        saveAnswer: vi.fn().mockResolvedValue(saved),
        processLatestProjection,
      },
    );

    expect(processLatestProjection).toHaveBeenCalledWith(undefined, "account-1", "diagnosis-1", at);
    expect(scheduleProjection).toHaveBeenCalledOnce();
  });
});
