import type { d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getSurveyDetail } from "./survey-detail";

const db = {} as d1.Client;
const at = new Date("2026-08-04T00:00:00.000Z");

describe("getSurveyDetail", () => {
  it("本人確認後に指定Surveyを取得する", async () => {
    const survey = {
      id: "survey-1",
      title: "タイトル",
      description: "説明",
      opensAt: at.toISOString(),
      closesAt: null,
      questions: [],
    };
    const findOpenSurveyDetail = vi.fn().mockResolvedValue({ type: "found", survey });

    const result = await getSurveyDetail(
      { surveyId: "survey-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1" },
        }),
        findOpenSurveyDetail,
      },
    );

    expect(findOpenSurveyDetail).toHaveBeenCalledWith(db, "survey-1", at);
    expect(result).toEqual({ type: "resolved", survey });
  });

  it.each([
    ["not-found", "survey-not-found"],
    ["closed", "survey-closed"],
  ] as const)("D1の%sを%sへ変換する", async (resultType, outcomeType) => {
    const result = await getSurveyDetail(
      { surveyId: "survey-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1" },
        }),
        findOpenSurveyDetail: vi.fn().mockResolvedValue({ type: resultType }),
      },
    );
    expect(result).toEqual({ type: outcomeType });
  });

  it("本人確認できない場合はD1から詳細を取得しない", async () => {
    const findOpenSurveyDetail = vi.fn();
    const session = { type: "unauthenticated" as const, reason: "invalid" };
    const result = await getSurveyDetail(
      { surveyId: "survey-1", idToken: undefined, lineLoginChannelId: "channel", db, at },
      { createSession: vi.fn().mockResolvedValue(session), findOpenSurveyDetail },
    );
    expect(result).toEqual(session);
    expect(findOpenSurveyDetail).not.toHaveBeenCalled();
  });
});
