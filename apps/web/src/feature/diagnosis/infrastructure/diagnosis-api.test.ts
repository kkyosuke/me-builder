import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  OperationError,
  UnknownError,
  ValidationError,
} from "../../../infrastructure/errors";
import {
  fetchDiagnosisDefinition,
  fetchDiagnosisList,
  fetchDiagnosisProgress,
  fetchDiagnosisResult,
  resetDevelopmentDiagnosisData,
  saveDiagnosisAnswer,
} from "./diagnosis-api";

const API_URL = "https://api.stg.kagami.kyosuke.dev";

describe("fetchDiagnosisList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Bearerトークンを付けて一覧APIを呼び、レスポンスを返すこと", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        diagnoses: [
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

    const diagnoses = await fetchDiagnosisList(API_URL, "dummy.id.token");

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/diagnoses`, {
      headers: { Authorization: "Bearer dummy.id.token" },
    });
    expect(diagnoses[0]).toMatchObject({
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

    await expect(fetchDiagnosisList(API_URL, "expired-token")).rejects.toThrow(
      "本人確認に失敗しました",
    );
  });

  it("不正なレスポンスを受け入れないこと", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ diagnoses: [{ id: "broken" }] })),
    );

    await expect(fetchDiagnosisList(API_URL, "dummy.id.token")).rejects.toThrow();
  });
});

describe("resetDevelopmentDiagnosisData", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Bearerトークンを付けてDELETEし、削除件数を返す", async () => {
    const deleted = {
      deletedResponseCount: 2,
      deletedAnswerCount: 12,
      deletedDeferredQuestionCount: 1,
      deletedSourceRecordCount: 12,
    };
    const fetchMock = vi.fn(async () => Response.json(deleted));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resetDevelopmentDiagnosisData(API_URL, "dummy.id.token")).resolves.toEqual(
      deleted,
    );
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/dev/diagnosis-data`, {
      method: "DELETE",
      headers: { Authorization: "Bearer dummy.id.token" },
    });
  });

  it.each([
    [401, AuthenticationError, "AUTHENTICATION_REQUIRED"],
    [404, OperationError, "DEVELOPMENT_RESET_UNAVAILABLE"],
    [500, UnknownError, "DEVELOPMENT_RESET_REQUEST_FAILED"],
  ] as const)("HTTP %sをcode %sへ変換する", async (status, ErrorType, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    try {
      await resetDevelopmentDiagnosisData(API_URL, "token");
      throw new Error("回答データ削除が成功してしまいました");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toMatchObject({ code, status });
    }
  });
});

describe("saveDiagnosisAnswer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("BearerトークンとChoice IDでPUTし保存結果を返す", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        outcome: "created",
        answer: {
          diagnosisQuestionId: "dq-1",
          questionId: "q-1",
          questionVersion: 1,
          choiceId: "yes",
          acceptedAt: "2026-08-05T00:00:00.000Z",
        },
        progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveDiagnosisAnswer(
      API_URL,
      "dummy.id.token",
      "relationship-priority",
      "dq-1",
      "yes",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/diagnoses/relationship-priority/answers/dq-1`,
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer dummy.id.token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ choiceId: "yes" }),
      },
    );
    expect(result).toMatchObject({
      outcome: "created",
      answer: { acceptedAt: "2026-08-05T00:00:00.000Z" },
      progress: { answeredCount: 1 },
    });
  });

  it.each([
    [401, undefined, AuthenticationError, "AUTHENTICATION_REQUIRED"],
    [404, undefined, OperationError, "DIAGNOSIS_UNAVAILABLE"],
    [409, { reason: "diagnosis_closed" }, OperationError, "DIAGNOSIS_CLOSED"],
    [409, { reason: "answer_change_requires_revision" }, OperationError, "ANSWER_CONFLICT"],
    [422, undefined, ValidationError, "INVALID_DIAGNOSIS_ANSWER"],
    [500, undefined, UnknownError, "DIAGNOSIS_ANSWER_REQUEST_FAILED"],
  ] as const)("HTTP %sをcode %sへ変換する", async (status, body, ErrorType, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (body ? Response.json(body, { status }) : new Response(null, { status }))),
    );
    try {
      await saveDiagnosisAnswer(API_URL, "token", "diagnosis", "sq", "yes");
      throw new Error("回答保存が成功してしまいました");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toMatchObject({ code, status });
    }
  });
});

describe("fetchDiagnosisDefinition", () => {
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
            diagnosisQuestionId: "dq-1",
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

    const definition = await fetchDiagnosisDefinition(
      API_URL,
      "dummy.id.token",
      "relationship-priority",
    );

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/diagnoses/relationship-priority`, {
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
    [404, OperationError, "DIAGNOSIS_UNAVAILABLE"],
    [409, OperationError, "DIAGNOSIS_CLOSED"],
    [500, UnknownError, "DIAGNOSIS_DETAIL_REQUEST_FAILED"],
  ] as const)("HTTP %sを汎用エラーとcodeへ変換する", async (status, ErrorType, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    try {
      await fetchDiagnosisDefinition(API_URL, "dummy.id.token", "relationship-priority");
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
      await fetchDiagnosisDefinition(API_URL, "dummy.id.token", "relationship-priority");
      throw new Error("不正なレスポンスを受け入れてしまいました");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ code: "DIAGNOSIS_DETAIL_INVALID_RESPONSE" });
    }
  });
});

describe("fetchDiagnosisResult", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("回答画面用の取得では404を未回答として扱う", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDiagnosisProgress(API_URL, "dummy.id.token", "relationship-priority"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/diagnoses/relationship-priority/answers`,
      {
        headers: { Authorization: "Bearer dummy.id.token" },
      },
    );
  });

  it("保存済み回答を取得して傾向プロフィールへ変換する", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "relationship-priority",
        title: "自分と相手の優先・境界線",
        description: "説明",
        responseStatus: "answered",
        answeredCount: 10,
        questionCount: 10,
        answers: Array.from({ length: 10 }, (_, index) => ({
          diagnosisQuestionId: `dq-relationship-priority-${String(index + 1).padStart(2, "0")}`,
          questionId: `q-relationship-priority-${String(index + 1).padStart(2, "0")}`,
          questionVersion: 1,
          questionText: `質問${index + 1}`,
          choiceId: "yes",
          choiceLabel: "はい",
          acceptedAt: "2026-08-05T00:00:00.000Z",
        })),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDiagnosisResult(API_URL, "dummy.id.token", "relationship-priority");

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/diagnoses/relationship-priority/answers`,
      {
        headers: { Authorization: "Bearer dummy.id.token" },
      },
    );
    expect(result).toMatchObject({
      id: "relationship-priority",
      profile: { scoringVersion: 1 },
    });
    expect(result?.answers[0]).toMatchObject({ choiceLabel: "はい" });
    expect(result?.profile.parameters).toHaveLength(4);
  });

  it.each([
    [401, AuthenticationError, "AUTHENTICATION_REQUIRED"],
    [404, OperationError, "DIAGNOSIS_ANSWERS_NOT_FOUND"],
    [500, UnknownError, "DIAGNOSIS_ANSWERS_REQUEST_FAILED"],
  ] as const)("HTTP %sを汎用エラーとcodeへ変換する", async (status, ErrorType, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    try {
      await fetchDiagnosisResult(API_URL, "dummy.id.token", "relationship-priority");
      throw new Error("回答内容取得が成功してしまいました");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toMatchObject({ code, status });
    }
  });
});
