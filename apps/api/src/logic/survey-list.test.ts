import type { d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getSurveyList } from "./survey-list";

const db = {} as d1.Client;
const at = new Date("2026-08-04T00:00:00.000Z");

describe("getSurveyList", () => {
  it("検証済みAccountのIDだけを使って一覧を取得すること", async () => {
    const createSession = vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1" },
    });
    const surveys = [
      {
        id: "survey-1",
        title: "タイトル",
        description: "説明",
        opensAt: "2026-08-01T00:00:00.000Z",
        closesAt: null,
        availability: "open" as const,
        responseStatus: "unanswered" as const,
        answeredCount: 0,
        questionCount: 3,
      },
    ];
    const listVisibleSurveys = vi.fn().mockResolvedValue(surveys);

    const result = await getSurveyList(
      { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
      { createSession, listVisibleSurveys },
    );

    expect(listVisibleSurveys).toHaveBeenCalledWith(db, "account-1", at);
    expect(result).toEqual({ type: "resolved", surveys });
  });

  it.each([
    { type: "not-configured" as const },
    { type: "unauthenticated" as const, reason: "invalid token" },
    { type: "account-not-found" as const },
  ])("セッションを解決できない場合は一覧を取得しないこと: $type", async (session) => {
    const listVisibleSurveys = vi.fn();

    const result = await getSurveyList(
      { idToken: undefined, lineLoginChannelId: undefined, db, at },
      {
        createSession: vi.fn().mockResolvedValue(session),
        listVisibleSurveys,
      },
    );

    expect(result).toEqual(session);
    expect(listVisibleSurveys).not.toHaveBeenCalled();
  });
});
