import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  OperationError,
  UnknownError,
  ValidationError,
} from "../../../infrastructure/errors";
import {
  deferDiagnosisQuestion,
  fetchDiagnosisDefinition,
  fetchDiagnosisList,
  fetchDiagnosisProgress,
  fetchDiagnosisResult,
  saveDiagnosisAnswer,
} from "./diagnosis-api";

const API_URL = "https://api.stg.kagami.kyosuke.dev";

describe("fetchDiagnosisList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("application session cookieで一覧APIを呼び、レスポンスを返すこと", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        diagnoses: [
          {
            id: "relationship-priority",
            title: "自分と相手の優先・境界線",
            description: "説明",
            relationshipCategory: "general",
            opensAt: "2026-08-04T00:00:00.000Z",
            closesAt: null,
            displayOrder: 10,
            availability: "open",
            responseStatus: "in-progress",
            answeredCount: 3,
            questionCount: 10,
            lastAnsweredAt: "2026-08-05T00:00:00.000Z",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const diagnoses = await fetchDiagnosisList(API_URL);

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/diagnoses`, {
      credentials: "include",
    });
    expect(diagnoses[0]).toMatchObject({
      id: "relationship-priority",
      displayOrder: 10,
      responseStatus: "in-progress",
      answeredCount: 3,
      lastAnsweredAt: "2026-08-05T00:00:00.000Z",
    });
  });

  it("APIエラーを画面表示用のメッセージに変換すること", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    await expect(fetchDiagnosisList(API_URL)).rejects.toThrow("本人確認に失敗しました");
  });

  it("不正なレスポンスを受け入れないこと", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ diagnoses: [{ id: "broken" }] })),
    );

    await expect(fetchDiagnosisList(API_URL)).rejects.toThrow();
  });
});

describe("saveDiagnosisAnswer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("application sessionとChoice IDでPUTし保存結果を返す", async () => {
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

    const result = await saveDiagnosisAnswer(API_URL, "relationship-priority", "dq-1", "yes");

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/diagnoses/relationship-priority/answers/dq-1`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ choiceId: "yes" }),
        credentials: "include",
      }),
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
    [409, { reason: "answer_is_immutable" }, OperationError, "ANSWER_CONFLICT"],
    [422, undefined, ValidationError, "INVALID_DIAGNOSIS_ANSWER"],
    [500, undefined, UnknownError, "DIAGNOSIS_ANSWER_REQUEST_FAILED"],
  ] as const)("HTTP %sをcode %sへ変換する", async (status, body, ErrorType, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (body ? Response.json(body, { status }) : new Response(null, { status }))),
    );
    try {
      await saveDiagnosisAnswer(API_URL, "diagnosis", "sq", "yes");
      throw new Error("回答保存が成功してしまいました");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toMatchObject({ code, status });
    }
  });
});

describe("deferDiagnosisQuestion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("application sessionでPUTし、延期結果を返す", async () => {
    const deferred = {
      outcome: "created",
      deferredQuestion: {
        diagnosisQuestionId: "dq-1",
        deferredAt: "2026-08-06T00:00:00.000Z",
      },
    };
    const fetchMock = vi.fn(async () => Response.json(deferred));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deferDiagnosisQuestion(API_URL, "relationship-priority", "dq-1")).resolves.toEqual(
      deferred,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/diagnoses/relationship-priority/deferred-questions/dq-1`,
      {
        method: "PUT",
        credentials: "include",
      },
    );
  });

  it.each([
    [401, undefined, AuthenticationError, "AUTHENTICATION_REQUIRED"],
    [404, undefined, OperationError, "DIAGNOSIS_UNAVAILABLE"],
    [409, { reason: "diagnosis_closed" }, OperationError, "DIAGNOSIS_CLOSED"],
    [409, { reason: "question_already_answered" }, OperationError, "ANSWER_CONFLICT"],
    [422, undefined, ValidationError, "INVALID_DIAGNOSIS_QUESTION"],
    [500, undefined, UnknownError, "DIAGNOSIS_DEFER_REQUEST_FAILED"],
  ] as const)("HTTP %sをcode %sへ変換する", async (status, body, ErrorType, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (body ? Response.json(body, { status }) : new Response(null, { status }))),
    );
    try {
      await deferDiagnosisQuestion(API_URL, "diagnosis", "dq-1");
      throw new Error("あとで回答の保存が成功してしまいました");
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
        relationshipCategory: "general",
        opensAt: "2026-08-04T00:00:00.000Z",
        closesAt: null,
        questions: [
          {
            diagnosisQuestionId: "dq-1",
            questionId: "q-1",
            questionVersion: 2,
            text: "API question",
            hint: null,
            format: "single_choice",
            choices: [
              { choiceId: "no", label: "いいえ", score: null },
              { choiceId: "yes", label: "はい", score: null },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const definition = await fetchDiagnosisDefinition(API_URL, "relationship-priority");

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/diagnoses/relationship-priority`, {
      credentials: "include",
    });
    expect(definition).toMatchObject({
      title: "API title",
      questions: [
        {
          questionVersion: 2,
          text: "API question",
          format: "single_choice",
          left: { choiceId: "no" },
          right: { choiceId: "yes" },
        },
      ],
    });
  });

  it("5段階のChoiceとscoreを順序どおり回答画面へ渡す", async () => {
    const labels = [
      "まったく当てはまらない",
      "あまり当てはまらない",
      "どちらともいえない",
      "やや当てはまる",
      "とても当てはまる",
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "likert",
          title: "5段階",
          description: "説明",
          relationshipCategory: "general",
          opensAt: "2026-08-04T00:00:00.000Z",
          closesAt: null,
          questions: [
            {
              diagnosisQuestionId: "dq-1",
              questionId: "q-1",
              questionVersion: 1,
              text: "質問",
              hint: null,
              format: "likert_5",
              choices: labels.map((label, index) => ({
                choiceId: `level-${index + 1}`,
                label,
                score: [-1, -0.5, 0, 0.5, 1][index],
              })),
            },
          ],
        }),
      ),
    );

    const definition = await fetchDiagnosisDefinition(API_URL, "likert");

    expect(definition.questions[0]).toMatchObject({
      format: "likert_5",
      choices: labels.map((label, index) => ({ label, score: [-1, -0.5, 0, 0.5, 1][index] })),
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
      await fetchDiagnosisDefinition(API_URL, "relationship-priority");
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
      await fetchDiagnosisDefinition(API_URL, "relationship-priority");
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

    await expect(fetchDiagnosisProgress(API_URL, "relationship-priority")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/diagnoses/relationship-priority/answers`,
      {
        credentials: "include",
      },
    );
  });

  it("保存済み回答とAPIで計算済みの傾向を取得する", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "relationship-priority",
        title: "自分と相手の優先・境界線",
        description: "説明",
        relationshipCategory: "general",
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
        scoring: {
          scoringVersion: 2,
          balancedLabel: "中間",
          parameters: [
            {
              id: "priority",
              label: "優先傾向",
              lowLabel: "相手を優先",
              highLabel: "自分を優先",
              score: 75,
              coverage: 100,
              band: "high",
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDiagnosisResult(API_URL, "relationship-priority");

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/diagnoses/relationship-priority/answers`,
      {
        credentials: "include",
      },
    );
    expect(result).toMatchObject({
      id: "relationship-priority",
      scoring: { scoringVersion: 2 },
    });
    expect(result?.answers[0]).toMatchObject({ choiceLabel: "はい" });
    expect(result?.scoring?.parameters).toHaveLength(1);
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
      await fetchDiagnosisResult(API_URL, "relationship-priority");
      throw new Error("回答内容取得が成功してしまいました");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toMatchObject({ code, status });
    }
  });
});
