import type { d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { resetDevelopmentSurveyData } from "./dev-survey-reset";

const db = {} as d1.Client;

describe("resetDevelopmentSurveyData", () => {
  it("本人確認で解決したAccountのアンケート回答データを削除する", async () => {
    const deleted = {
      deletedResponseCount: 2,
      deletedAnswerCount: 12,
      deletedDeferredQuestionCount: 1,
      deletedSourceRecordCount: 12,
    };
    const deleteSurveyData = vi.fn().mockResolvedValue(deleted);

    const result = await resetDevelopmentSurveyData(
      { idToken: "token", lineLoginChannelId: "channel", db },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1" },
        }),
        deleteSurveyData,
      },
    );

    expect(deleteSurveyData).toHaveBeenCalledWith(db, "account-1");
    expect(result).toEqual({ type: "resolved", ...deleted });
  });

  it("本人確認できない場合は削除しない", async () => {
    const deleteSurveyData = vi.fn();
    const session = { type: "unauthenticated" as const, reason: "invalid" };

    const result = await resetDevelopmentSurveyData(
      { idToken: undefined, lineLoginChannelId: "channel", db },
      { createSession: vi.fn().mockResolvedValue(session), deleteSurveyData },
    );

    expect(result).toEqual(session);
    expect(deleteSurveyData).not.toHaveBeenCalled();
  });
});
