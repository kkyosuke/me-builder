import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { SaveSurveyAnswerOutcome } from "../logic/survey-answer";
import type { SurveyDetailOutcome } from "../logic/survey-detail";
import type { SurveyListOutcome } from "../logic/survey-list";

const { getSurveyList, getSurveyDetail, saveSurveyAnswer } = vi.hoisted(() => ({
  getSurveyList: vi.fn(),
  getSurveyDetail: vi.fn(),
  saveSurveyAnswer: vi.fn(),
}));

vi.mock("../logic/survey-list", () => ({ getSurveyList }));
vi.mock("../logic/survey-detail", () => ({ getSurveyDetail }));
vi.mock("../logic/survey-answer", () => ({ saveSurveyAnswer }));

const dummyDb = {} as D1Database;
const LIFF_ID = "2010850319-Yl63upAR";

function request(env: Record<string, unknown> = {}, authorization = "Bearer dummy.id.token") {
  return app.request(
    "/api/surveys",
    { headers: { Authorization: authorization } },
    { LIFF_ID, DB: dummyDb, ...env },
  );
}

const outcome = (value: SurveyListOutcome) => getSurveyList.mockResolvedValue(value);
const detailOutcome = (value: SurveyDetailOutcome) => getSurveyDetail.mockResolvedValue(value);
const answerOutcome = (value: SaveSurveyAnswerOutcome) => saveSurveyAnswer.mockResolvedValue(value);

describe("GET /api/surveys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolved を200と一覧へ変換すること", async () => {
    outcome({ type: "resolved", surveys: [] });

    const res = await request();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ surveys: [] });
    expect(getSurveyList).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: "dummy.id.token", lineLoginChannelId: "2010850319" }),
    );
  });

  it.each([
    ["unauthenticated", { type: "unauthenticated", reason: "invalid" }],
    ["not-configured", { type: "not-configured" }],
  ] as const)("%s を401へ変換すること", async (_name, value) => {
    outcome(value);

    const res = await request();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("Bearer形式でない認証情報をIDトークンとして渡さないこと", async () => {
    outcome({ type: "unauthenticated", reason: "missing" });

    await request({}, "Basic credentials");

    expect(getSurveyList).toHaveBeenCalledWith(expect.objectContaining({ idToken: undefined }));
  });

  it("account-not-found を404へ変換すること", async () => {
    outcome({ type: "account-not-found" });

    const res = await request();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Account not found",
      reason: "friendship_required",
    });
  });

  it("DBバインディングが無い場合はlogicを呼ばず503を返すこと", async () => {
    outcome({ type: "resolved", surveys: [] });

    const res = await app.request(
      "/api/surveys",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID },
    );

    expect(res.status).toBe(503);
    expect(getSurveyList).not.toHaveBeenCalled();
  });
});

describe("PUT /api/surveys/:surveyId/answers/:surveyQuestionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const put = (body: string = JSON.stringify({ choiceId: "yes" }), withDb = true) =>
    app.request(
      "/api/surveys/survey-1/answers/sq-1",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer dummy.id.token",
          "Content-Type": "application/json",
        },
        body,
      },
      { LIFF_ID, ...(withDb ? { DB: dummyDb } : {}) },
    );

  it("savedを200と保存結果へ変換する", async () => {
    answerOutcome({
      type: "saved",
      outcome: "created",
      answer: {
        surveyQuestionId: "sq-1",
        questionId: "q-1",
        questionVersion: 1,
        choiceId: "yes",
        acceptedAt: "2026-08-05T00:00:00.000Z",
      },
      progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 2 },
    });
    const response = await put();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "created",
      progress: { responseStatus: "in-progress", answeredCount: 1 },
    });
    expect(saveSurveyAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        surveyId: "survey-1",
        surveyQuestionId: "sq-1",
        choiceId: "yes",
        idToken: "dummy.id.token",
      }),
    );
  });

  it.each(["not-json", "{}", '{"choiceId":""}'])("不正なbody %sを400にする", async (body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(saveSurveyAnswer).not.toHaveBeenCalled();
  });

  it.each([
    ["survey-not-found", 404, { error: "Survey not found", reason: "survey_not_found" }],
    ["survey-closed", 409, { error: "Survey closed", reason: "survey_closed" }],
    [
      "survey-question-not-found",
      422,
      { error: "Invalid answer", reason: "survey_question_not_found" },
    ],
    ["choice-not-found", 422, { error: "Invalid answer", reason: "choice_not_found" }],
    [
      "answer-conflict",
      409,
      { error: "Answer already exists", reason: "answer_change_requires_revision" },
    ],
    ["unauthenticated", 401, { error: "Unauthorized" }],
  ] as const)("%sをHTTP %sへ変換する", async (type, status, body) => {
    answerOutcome(type === "unauthenticated" ? { type, reason: "invalid" } : { type });
    const response = await put();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it("DB bindingが無ければ503を返す", async () => {
    const response = await put(undefined, false);
    expect(response.status).toBe(503);
    expect(saveSurveyAnswer).not.toHaveBeenCalled();
  });
});

describe("GET /api/surveys/:surveyId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolvedを200と詳細へ変換する", async () => {
    detailOutcome({
      type: "resolved",
      survey: {
        id: "survey-1",
        title: "タイトル",
        description: "説明",
        opensAt: "2026-08-04T00:00:00.000Z",
        closesAt: null,
        questions: [
          {
            surveyQuestionId: "sq-1",
            questionId: "q-1",
            questionVersion: 1,
            text: "質問",
            hint: null,
            choices: [
              { choiceId: "no", label: "いいえ", presentation: {} },
              { choiceId: "yes", label: "はい", presentation: {} },
            ],
          },
        ],
      },
    });

    const res = await app.request(
      "/api/surveys/survey-1",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID, DB: dummyDb },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("survey-1");
    expect(getSurveyDetail).toHaveBeenCalledWith(
      expect.objectContaining({ surveyId: "survey-1", idToken: "dummy.id.token" }),
    );
  });

  it.each([
    ["survey-not-found", 404, { error: "Survey not found", reason: "survey_not_found" }],
    ["survey-closed", 409, { error: "Survey closed", reason: "survey_closed" }],
    ["unauthenticated", 401, { error: "Unauthorized" }],
  ] as const)("%sをHTTP %sへ変換する", async (type, status, body) => {
    detailOutcome(type === "unauthenticated" ? { type, reason: "invalid" } : { type });
    const res = await app.request(
      "/api/surveys/survey-1",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID, DB: dummyDb },
    );
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("DB bindingが無ければ503を返す", async () => {
    const res = await app.request("/api/surveys/survey-1", {}, { LIFF_ID });
    expect(res.status).toBe(503);
    expect(getSurveyDetail).not.toHaveBeenCalled();
  });
});
