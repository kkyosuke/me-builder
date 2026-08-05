import type { d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { saveSurveyAnswer } from "./survey-answer";

const db = {} as d1.Client;
const at = new Date("2026-08-05T00:00:00.000Z");

describe("saveSurveyAnswer", () => {
  it("検証済みAccount IDだけをD1 actionへ渡す", async () => {
    const saved = {
      type: "saved" as const,
      outcome: "created" as const,
      answer: {
        surveyQuestionId: "sq-1",
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
    const result = await saveSurveyAnswer(
      {
        surveyId: "survey-1",
        surveyQuestionId: "sq-1",
        choiceId: "yes",
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        at,
      },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1" },
        }),
        saveAnswer,
      },
    );
    expect(saveAnswer).toHaveBeenCalledWith(db, {
      accountId: "account-1",
      surveyId: "survey-1",
      surveyQuestionId: "sq-1",
      choiceId: "yes",
      at,
    });
    expect(result).toEqual(saved);
  });

  it("本人確認できない場合はD1へ書き込まない", async () => {
    const saveAnswer = vi.fn();
    const session = { type: "unauthenticated" as const, reason: "invalid" };
    const result = await saveSurveyAnswer(
      {
        surveyId: "survey-1",
        surveyQuestionId: "sq-1",
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
});
