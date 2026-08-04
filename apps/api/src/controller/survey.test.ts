import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { SurveyListOutcome } from "../logic/survey-list";

const { getSurveyList } = vi.hoisted(() => ({ getSurveyList: vi.fn() }));

vi.mock("../logic/survey-list", () => ({ getSurveyList }));

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
