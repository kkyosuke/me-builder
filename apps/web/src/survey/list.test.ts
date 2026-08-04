import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSurveyList } from "./list";

const API_URL = "https://api.stg.kagami.kyosuke.dev";

describe("fetchSurveyList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Bearerトークンを付けて一覧APIを呼び、レスポンスを返すこと", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        surveys: [
          {
            id: "relationship-priority",
            title: "自分と相手の優先・境界線",
            description: "説明",
            opensAt: "2026-08-04T00:00:00.000Z",
            closesAt: null,
            availability: "open",
            responseStatus: "in-progress",
            answeredCount: 3,
            questionCount: 10,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const surveys = await fetchSurveyList(API_URL, "dummy.id.token");

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/surveys`, {
      headers: { Authorization: "Bearer dummy.id.token" },
    });
    expect(surveys[0]).toMatchObject({
      id: "relationship-priority",
      responseStatus: "in-progress",
      answeredCount: 3,
    });
  });

  it("APIエラーを画面表示用のメッセージに変換すること", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    await expect(fetchSurveyList(API_URL, "expired-token")).rejects.toThrow(
      "本人確認に失敗しました",
    );
  });

  it("不正なレスポンスを受け入れないこと", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ surveys: [{ id: "broken" }] })),
    );

    await expect(fetchSurveyList(API_URL, "dummy.id.token")).rejects.toThrow();
  });
});
