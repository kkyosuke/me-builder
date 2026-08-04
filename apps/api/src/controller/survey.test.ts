import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { SurveyDetailOutcome } from "../logic/survey-detail";
import type { SurveyListOutcome } from "../logic/survey-list";

const { getSurveyList, getSurveyDetail } = vi.hoisted(() => ({
  getSurveyList: vi.fn(),
  getSurveyDetail: vi.fn(),
}));

vi.mock("../logic/survey-list", () => ({ getSurveyList }));
vi.mock("../logic/survey-detail", () => ({ getSurveyDetail }));

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
