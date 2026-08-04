import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  OperationError,
  UnknownError,
  ValidationError,
} from "../../../infrastructure/errors";
import { fetchSurveyDefinition, fetchSurveyList } from "./survey-api";

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

describe("fetchSurveyDefinition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("詳細APIのQuestion VersionとChoiceを回答画面の左右へ変換する", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "relationship-priority",
        title: "API title",
        description: "API description",
        opensAt: "2026-08-04T00:00:00.000Z",
        closesAt: null,
        questions: [
          {
            surveyQuestionId: "sq-1",
            questionId: "q-1",
            questionVersion: 2,
            text: "API question",
            hint: null,
            choices: [
              { choiceId: "no", label: "いいえ", presentation: { icon: "circle-x" } },
              { choiceId: "yes", label: "はい", presentation: { icon: "circle-check" } },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const definition = await fetchSurveyDefinition(
      API_URL,
      "dummy.id.token",
      "relationship-priority",
    );

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/surveys/relationship-priority`, {
      headers: { Authorization: "Bearer dummy.id.token" },
    });
    expect(definition).toMatchObject({
      title: "API title",
      questions: [
        {
          questionVersion: 2,
          text: "API question",
          left: { choiceId: "no", icon: "circle-x" },
          right: { choiceId: "yes", icon: "circle-check" },
        },
      ],
    });
  });

  it.each([
    [401, AuthenticationError, "AUTHENTICATION_REQUIRED"],
    [404, OperationError, "SURVEY_UNAVAILABLE"],
    [409, OperationError, "SURVEY_CLOSED"],
    [500, UnknownError, "SURVEY_DETAIL_REQUEST_FAILED"],
  ] as const)("HTTP %sを汎用エラーとcodeへ変換する", async (status, ErrorType, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    try {
      await fetchSurveyDefinition(API_URL, "dummy.id.token", "relationship-priority");
      throw new Error("詳細取得が成功してしまいました");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toMatchObject({ code, status });
    }
  });

  it("APIレスポンスを回答画面へ変換する前に検証する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "broken" })),
    );

    try {
      await fetchSurveyDefinition(API_URL, "dummy.id.token", "relationship-priority");
      throw new Error("不正なレスポンスを受け入れてしまいました");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ code: "SURVEY_DETAIL_INVALID_RESPONSE" });
    }
  });
});
