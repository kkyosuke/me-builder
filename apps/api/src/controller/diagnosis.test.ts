import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { ResetDevelopmentDiagnosisDataOutcome } from "../logic/dev-diagnosis-reset";
import type { SaveDiagnosisAnswerOutcome } from "../logic/diagnosis-answer";
import type { DiagnosisAnswersOutcome } from "../logic/diagnosis-answers";
import type { DeferDiagnosisQuestionOutcome } from "../logic/diagnosis-deferred-question";
import type { DiagnosisDetailOutcome } from "../logic/diagnosis-detail";
import type { DiagnosisListOutcome } from "../logic/diagnosis-list";

const {
  getDiagnosisList,
  getDiagnosisDetail,
  getDiagnosisAnswers,
  saveDiagnosisAnswer,
  deferDiagnosisQuestion,
  resetDevelopmentDiagnosisData,
} = vi.hoisted(() => ({
  getDiagnosisList: vi.fn(),
  getDiagnosisDetail: vi.fn(),
  getDiagnosisAnswers: vi.fn(),
  saveDiagnosisAnswer: vi.fn(),
  deferDiagnosisQuestion: vi.fn(),
  resetDevelopmentDiagnosisData: vi.fn(),
}));

vi.mock("../logic/diagnosis-list", () => ({ getDiagnosisList }));
vi.mock("../logic/diagnosis-detail", () => ({ getDiagnosisDetail }));
vi.mock("../logic/diagnosis-answers", () => ({ getDiagnosisAnswers }));
vi.mock("../logic/diagnosis-answer", () => ({ saveDiagnosisAnswer }));
vi.mock("../logic/diagnosis-deferred-question", () => ({ deferDiagnosisQuestion }));
vi.mock("../logic/dev-diagnosis-reset", () => ({ resetDevelopmentDiagnosisData }));

const dummyDb = {} as D1Database;
const dummyAccountData = {} as AccountDataNamespace;
const LIFF_ID = "2010850319-Yl63upAR";

function request(env: Record<string, unknown> = {}, authorization = "Bearer dummy.id.token") {
  return app.request(
    "/api/diagnoses",
    { headers: { Authorization: authorization } },
    { LIFF_ID, DB: dummyDb, ACCOUNT_DATA: dummyAccountData, ...env },
  );
}

const outcome = (value: DiagnosisListOutcome) => getDiagnosisList.mockResolvedValue(value);
const detailOutcome = (value: DiagnosisDetailOutcome) =>
  getDiagnosisDetail.mockResolvedValue(value);
const answerOutcome = (value: SaveDiagnosisAnswerOutcome) =>
  saveDiagnosisAnswer.mockResolvedValue(value);
const deferOutcome = (value: DeferDiagnosisQuestionOutcome) =>
  deferDiagnosisQuestion.mockResolvedValue(value);
const answersOutcome = (value: DiagnosisAnswersOutcome) =>
  getDiagnosisAnswers.mockResolvedValue(value);
const resetOutcome = (value: ResetDevelopmentDiagnosisDataOutcome) =>
  resetDevelopmentDiagnosisData.mockResolvedValue(value);

describe("GET /api/diagnoses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolved を200と一覧へ変換すること", async () => {
    outcome({ type: "resolved", diagnoses: [] });

    const res = await request();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ diagnoses: [] });
    expect(getDiagnosisList).toHaveBeenCalledWith(
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

    expect(getDiagnosisList).toHaveBeenCalledWith(expect.objectContaining({ idToken: undefined }));
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
    outcome({ type: "resolved", diagnoses: [] });

    const res = await app.request(
      "/api/diagnoses",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID },
    );

    expect(res.status).toBe(503);
    expect(getDiagnosisList).not.toHaveBeenCalled();
  });
});

describe("PUT /api/diagnoses/:diagnosisId/answers/:diagnosisQuestionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const put = (body: string = JSON.stringify({ choiceId: "yes" }), withDb = true) =>
    app.request(
      "/api/diagnoses/diagnosis-1/answers/dq-1",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer dummy.id.token",
          "Content-Type": "application/json",
        },
        body,
      },
      { LIFF_ID, ...(withDb ? { DB: dummyDb, ACCOUNT_DATA: dummyAccountData } : {}) },
    );

  it("savedを200と保存結果へ変換する", async () => {
    answerOutcome({
      type: "saved",
      outcome: "created",
      answer: {
        diagnosisQuestionId: "dq-1",
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
    expect(saveDiagnosisAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnosisId: "diagnosis-1",
        diagnosisQuestionId: "dq-1",
        choiceId: "yes",
        idToken: "dummy.id.token",
      }),
    );
  });

  it.each(["not-json", "{}", '{"choiceId":""}'])("不正なbody %sを400にする", async (body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(saveDiagnosisAnswer).not.toHaveBeenCalled();
  });

  it.each([
    ["diagnosis-not-found", 404, { error: "Diagnosis not found", reason: "diagnosis_not_found" }],
    ["diagnosis-closed", 409, { error: "Diagnosis closed", reason: "diagnosis_closed" }],
    [
      "diagnosis-question-not-found",
      422,
      { error: "Invalid answer", reason: "diagnosis_question_not_found" },
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
    expect(saveDiagnosisAnswer).not.toHaveBeenCalled();
  });
});

describe("PUT /api/diagnoses/:diagnosisId/deferred-questions/:diagnosisQuestionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const put = (withDb = true) =>
    app.request(
      "/api/diagnoses/diagnosis-1/deferred-questions/dq-1",
      { method: "PUT", headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID, ...(withDb ? { DB: dummyDb, ACCOUNT_DATA: dummyAccountData } : {}) },
    );

  it("deferredを200と保存結果へ変換する", async () => {
    deferOutcome({
      type: "deferred",
      outcome: "created",
      deferredQuestion: {
        diagnosisQuestionId: "dq-1",
        deferredAt: "2026-08-06T00:00:00.000Z",
      },
    });

    const response = await put();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "created",
      deferredQuestion: {
        diagnosisQuestionId: "dq-1",
        deferredAt: "2026-08-06T00:00:00.000Z",
      },
    });
    expect(deferDiagnosisQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnosisId: "diagnosis-1",
        diagnosisQuestionId: "dq-1",
        idToken: "dummy.id.token",
      }),
    );
  });

  it.each([
    ["diagnosis-not-found", 404, { error: "Diagnosis not found", reason: "diagnosis_not_found" }],
    ["diagnosis-closed", 409, { error: "Diagnosis closed", reason: "diagnosis_closed" }],
    [
      "diagnosis-question-not-found",
      422,
      { error: "Invalid deferred question", reason: "diagnosis_question_not_found" },
    ],
    [
      "question-already-answered",
      409,
      { error: "Question already answered", reason: "question_already_answered" },
    ],
    ["unauthenticated", 401, { error: "Unauthorized" }],
  ] as const)("%sをHTTP %sへ変換する", async (type, status, body) => {
    deferOutcome(type === "unauthenticated" ? { type, reason: "invalid" } : { type });
    const response = await put();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it("DB bindingが無ければ503を返す", async () => {
    const response = await put(false);
    expect(response.status).toBe(503);
    expect(deferDiagnosisQuestion).not.toHaveBeenCalled();
  });
});

describe("GET /api/diagnoses/:diagnosisId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolvedを200と詳細へ変換する", async () => {
    detailOutcome({
      type: "resolved",
      diagnosis: {
        id: "diagnosis-1",
        title: "タイトル",
        description: "説明",
        opensAt: "2026-08-04T00:00:00.000Z",
        closesAt: null,
        questions: [
          {
            diagnosisQuestionId: "dq-1",
            questionId: "q-1",
            questionVersion: 1,
            text: "質問",
            hint: null,
            choices: [
              { choiceId: "no", label: "いいえ" },
              { choiceId: "yes", label: "はい" },
            ],
          },
        ],
      },
    });

    const res = await app.request(
      "/api/diagnoses/diagnosis-1",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID, DB: dummyDb, ACCOUNT_DATA: dummyAccountData },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("diagnosis-1");
    expect(getDiagnosisDetail).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosisId: "diagnosis-1", idToken: "dummy.id.token" }),
    );
  });

  it.each([
    ["diagnosis-not-found", 404, { error: "Diagnosis not found", reason: "diagnosis_not_found" }],
    ["diagnosis-closed", 409, { error: "Diagnosis closed", reason: "diagnosis_closed" }],
    ["unauthenticated", 401, { error: "Unauthorized" }],
  ] as const)("%sをHTTP %sへ変換する", async (type, status, body) => {
    detailOutcome(type === "unauthenticated" ? { type, reason: "invalid" } : { type });
    const res = await app.request(
      "/api/diagnoses/diagnosis-1",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID, DB: dummyDb, ACCOUNT_DATA: dummyAccountData },
    );
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("DB bindingが無ければ503を返す", async () => {
    const res = await app.request("/api/diagnoses/diagnosis-1", {}, { LIFF_ID });
    expect(res.status).toBe(503);
    expect(getDiagnosisDetail).not.toHaveBeenCalled();
  });
});

describe("GET /api/diagnoses/:diagnosisId/answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const get = (withDb = true) =>
    app.request(
      "/api/diagnoses/diagnosis-1/answers",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID, ...(withDb ? { DB: dummyDb, ACCOUNT_DATA: dummyAccountData } : {}) },
    );

  it("resolvedを200と回答内容へ変換する", async () => {
    answersOutcome({
      type: "resolved",
      diagnosis: {
        id: "diagnosis-1",
        title: "タイトル",
        description: "説明",
        responseStatus: "answered",
        answeredCount: 1,
        questionCount: 1,
        scoring: null,
        answers: [
          {
            diagnosisQuestionId: "dq-1",
            questionId: "q-1",
            questionVersion: 1,
            questionText: "質問",
            choiceId: "yes",
            choiceLabel: "はい",
            acceptedAt: "2026-08-05T00:00:00.000Z",
          },
        ],
      },
    });

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "diagnosis-1",
      responseStatus: "answered",
      answers: [{ choiceLabel: "はい" }],
      scoring: null,
    });
    expect(getDiagnosisAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosisId: "diagnosis-1", idToken: "dummy.id.token" }),
    );
  });

  it.each([
    [
      "diagnosis-answers-not-found",
      404,
      { error: "Diagnosis answers not found", reason: "diagnosis_answers_not_found" },
    ],
    ["account-not-found", 404, { error: "Account not found", reason: "friendship_required" }],
    ["unauthenticated", 401, { error: "Unauthorized" }],
  ] as const)("%sをHTTP %sへ変換する", async (type, status, body) => {
    answersOutcome(type === "unauthenticated" ? { type, reason: "invalid" } : { type });
    const response = await get();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it("DB bindingが無ければ503を返す", async () => {
    const response = await get(false);
    expect(response.status).toBe(503);
    expect(getDiagnosisAnswers).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/dev/diagnosis-data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const remove = (environment: string | undefined, withDb = true) =>
    app.request(
      "/api/dev/diagnosis-data",
      { method: "DELETE", headers: { Authorization: "Bearer dummy.id.token" } },
      {
        LIFF_ID,
        ...(environment === undefined ? {} : { ENVIRONMENT: environment }),
        ...(withDb ? { DB: dummyDb, ACCOUNT_DATA: dummyAccountData } : {}),
      },
    );

  it("previewではresolvedを200と削除件数へ変換する", async () => {
    resetOutcome({
      type: "resolved",
      deletedResponseCount: 2,
      deletedAnswerCount: 12,
      deletedDeferredQuestionCount: 1,
      deletedSourceRecordCount: 12,
      deletedBrainItemCount: 4,
    });

    const response = await remove("preview");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deletedResponseCount: 2,
      deletedAnswerCount: 12,
      deletedDeferredQuestionCount: 1,
      deletedSourceRecordCount: 12,
      deletedBrainItemCount: 4,
    });
    expect(resetDevelopmentDiagnosisData).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: "dummy.id.token", lineLoginChannelId: "2010850319" }),
    );
  });

  it.each(["production", "staging"])("%sでは404にして削除処理を呼ばない", async (environment) => {
    const response = await remove(environment);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not Found" });
    expect(resetDevelopmentDiagnosisData).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])(
    "ENVIRONMENTが%sなら404にして削除処理を呼ばない",
    async (environment) => {
      const response = await remove(environment);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not Found" });
      expect(resetDevelopmentDiagnosisData).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["account-not-found", 404, { error: "Account not found", reason: "friendship_required" }],
    ["unauthenticated", 401, { error: "Unauthorized" }],
  ] as const)("%sをHTTP %sへ変換する", async (type, status, body) => {
    resetOutcome(type === "unauthenticated" ? { type, reason: "invalid" } : { type });
    const response = await remove("preview");
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it("開発環境でもDB bindingが無ければ503を返す", async () => {
    const response = await remove("preview", false);
    expect(response.status).toBe(503);
    expect(resetDevelopmentDiagnosisData).not.toHaveBeenCalled();
  });
});
