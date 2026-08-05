// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  SurveyAnswer,
  SurveyDefinition,
  SurveyListItem,
  SurveyResult,
} from "./feature/survey";
import { OperationError } from "./infrastructure/errors";

const mocks = vi.hoisted(() => ({
  config: {
    environment: "development" as string | undefined,
    liffId: "test-liff-id",
    apiUrl: "https://api.example.com",
  },
  initializeLiff: vi.fn(),
  getLiffIdToken: vi.fn(),
  fetchSurveyList: vi.fn(),
  fetchSurveyDefinition: vi.fn(),
  fetchSurveyResult: vi.fn(),
  saveSurveyAnswer: vi.fn(),
  resetDevelopmentSurveyData: vi.fn(),
}));

vi.mock("./config", () => ({
  config: mocks.config,
}));
vi.mock("./feature/liff", () => ({
  initializeLiff: mocks.initializeLiff,
  getLiffIdToken: mocks.getLiffIdToken,
}));
vi.mock("./feature/survey", () => ({
  fetchSurveyList: mocks.fetchSurveyList,
  fetchSurveyDefinition: mocks.fetchSurveyDefinition,
  fetchSurveyResult: mocks.fetchSurveyResult,
  saveSurveyAnswer: mocks.saveSurveyAnswer,
  resetDevelopmentSurveyData: mocks.resetDevelopmentSurveyData,
  SwipeSurvey: ({
    survey,
    onSaveAnswer,
    onComplete,
  }: {
    survey: SurveyDefinition;
    onSaveAnswer: (answer: SurveyAnswer) => Promise<unknown>;
    onComplete: () => void;
  }) => (
    <div>
      <p>{`回答UI: ${survey.title}`}</p>
      <button
        type="button"
        onClick={() =>
          void onSaveAnswer({
            kind: "answer",
            surveyQuestionId: "sq-1",
            questionId: "q-1",
            questionVersion: 1,
            choiceId: "yes",
            direction: "right",
            acceptedAt: "2026-08-05T00:00:00.000Z",
          })
        }
      >
        テスト回答
      </button>
      <button type="button" onClick={onComplete}>
        テスト完了
      </button>
    </div>
  ),
  SurveyResultView: ({ result }: { result: SurveyResult }) => (
    <div>{`結果UI: ${result.title} (${result.answers.length}件)`}</div>
  ),
}));

const definition: SurveyDefinition = {
  id: "survey-1",
  title: "テストアンケート",
  description: "説明",
  questions: [],
  balancedLabel: "中間",
  score: () => ({ scoringVersion: 1, parameters: [] }),
};

const result: SurveyResult = {
  id: "survey-1",
  title: "テストアンケート",
  description: "説明",
  responseStatus: "answered",
  answeredCount: 10,
  questionCount: 10,
  answers: [
    {
      surveyQuestionId: "sq-1",
      questionId: "q-1",
      questionVersion: 1,
      questionText: "質問",
      choiceId: "yes",
      choiceLabel: "はい",
      acceptedAt: "2026-08-05T00:00:00.000Z",
    },
  ],
  balancedLabel: "中間",
  profile: { scoringVersion: 1, parameters: [] },
};

function survey(overrides: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: "survey-1",
    title: "テストアンケート",
    description: "説明",
    opensAt: "2026-08-04T00:00:00.000Z",
    closesAt: null,
    availability: "open",
    responseStatus: "unanswered",
    answeredCount: 0,
    questionCount: 10,
    ...overrides,
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.environment = "development";
    mocks.initializeLiff.mockResolvedValue({
      status: "ready",
      inClient: true,
      profile: { displayName: "テスト" },
    });
    mocks.getLiffIdToken.mockReturnValue("dummy.id.token");
    mocks.fetchSurveyList.mockResolvedValue([survey()]);
    mocks.fetchSurveyDefinition.mockResolvedValue(definition);
    mocks.fetchSurveyResult.mockResolvedValue(result);
    mocks.saveSurveyAnswer.mockResolvedValue({
      outcome: "created",
      answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
      progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
    });
    mocks.resetDevelopmentSurveyData.mockResolvedValue({
      deletedResponseCount: 1,
      deletedAnswerCount: 10,
      deletedDeferredQuestionCount: 0,
      deletedSourceRecordCount: 10,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("受付中かつ未回答なら回答画面へ進み、1問ずつ保存することを表示する", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テストアンケート/ }));

    expect(await screen.findByText("回答UI: テストアンケート")).toBeTruthy();
    expect(screen.getByText(/回答は1問ずつ保存されます/)).toBeTruthy();
  });

  it("dev環境では確認後に本人の回答データを全削除し、一覧を再取得する", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "回答データを全削除" }));

    await waitFor(() =>
      expect(mocks.resetDevelopmentSurveyData).toHaveBeenCalledWith(
        "https://api.example.com",
        "dummy.id.token",
      ),
    );
    expect(await screen.findByText("回答データを削除しました（回答・保留 10件）。")).toBeTruthy();
    expect(mocks.fetchSurveyList).toHaveBeenCalledTimes(2);
  });

  it("dev環境の回答データ削除を確認でキャンセルできる", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "回答データを全削除" }));

    expect(mocks.resetDevelopmentSurveyData).not.toHaveBeenCalled();
  });

  it("production環境では開発用データ操作を表示しない", async () => {
    mocks.config.environment = "production";
    render(<App />);

    await screen.findByRole("button", { name: /テストアンケート/ });
    expect(screen.queryByRole("button", { name: "回答データを全削除" })).toBeNull();
  });

  it("環境変数未設定では開発用データ操作を表示しない", async () => {
    mocks.config.environment = undefined;
    render(<App />);

    await screen.findByRole("button", { name: /テストアンケート/ });
    expect(screen.queryByRole("button", { name: "回答データを全削除" })).toBeNull();
  });

  it("回答UIの選択を保存APIへ接続する", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /テストアンケート/ }));
    fireEvent.click(await screen.findByRole("button", { name: "テスト回答" }));
    await waitFor(() =>
      expect(mocks.saveSurveyAnswer).toHaveBeenCalledWith(
        "https://api.example.com",
        "dummy.id.token",
        "survey-1",
        "sq-1",
        "yes",
      ),
    );
  });

  it("全回答の保存完了後は保存済み回答を取得して結果画面へ進む", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /テストアンケート/ }));

    fireEvent.click(await screen.findByRole("button", { name: "テスト完了" }));

    expect(await screen.findByText("結果UI: テストアンケート (1件)")).toBeTruthy();
    expect(mocks.fetchSurveyResult).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      "survey-1",
      expect.any(AbortSignal),
    );
  });

  it.each([
    {
      name: "受付終了かつ未回答",
      item: survey({ availability: "closed" }),
      heading: "このアンケートは受付を終了しました",
    },
    {
      name: "回答途中",
      item: survey({ responseStatus: "in-progress", answeredCount: 3 }),
      heading: "回答の再開機能は現在準備中です",
    },
  ])("$name では新規回答を始めず案内へ進む", async ({ item, heading }) => {
    mocks.fetchSurveyList.mockResolvedValue([item]);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テストアンケート/ }));

    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.queryByText(/回答UI:/)).toBeNull();
  });

  it.each([
    survey({ responseStatus: "answered", answeredCount: 10 }),
    survey({ availability: "closed", responseStatus: "answered", answeredCount: 10 }),
  ])("回答済みなら受付状態にかかわらず保存済み結果を表示する", async (item) => {
    mocks.fetchSurveyList.mockResolvedValue([item]);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テストアンケート/ }));

    expect(await screen.findByText("結果UI: テストアンケート (1件)")).toBeTruthy();
    expect(mocks.fetchSurveyResult).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      "survey-1",
      expect.any(AbortSignal),
    );
    expect(mocks.fetchSurveyDefinition).not.toHaveBeenCalled();
  });

  it("ローカルのスコア設定がないアンケートを選ぶと未対応の案内へ進む", async () => {
    mocks.fetchSurveyDefinition.mockResolvedValue(undefined);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テストアンケート/ }));

    expect(
      await screen.findByRole("heading", {
        name: "このアンケートは現在のアプリでは未対応です",
      }),
    ).toBeTruthy();
  });

  it.each([
    {
      code: "SURVEY_UNAVAILABLE",
      heading: "このアンケートは現在のアプリでは未対応です",
    },
    {
      code: "SURVEY_CLOSED",
      heading: "このアンケートは受付を終了しました",
    },
  ])("詳細取得の$codeを対応する案内へ変換する", async ({ code, heading }) => {
    mocks.fetchSurveyDefinition.mockRejectedValue(new OperationError("detail error", { code }));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テストアンケート/ }));

    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
  });

  it("一覧取得失敗後の再試行でLIFF初期化と一覧取得を同じ順序で再実行する", async () => {
    mocks.fetchSurveyList
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([survey()]);
    render(<App />);

    const retry = await screen.findByRole("button", { name: "再試行" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(await screen.findByRole("button", { name: /テストアンケート/ })).toBeTruthy();
    expect(mocks.initializeLiff).toHaveBeenCalledTimes(2);
    expect(mocks.fetchSurveyList).toHaveBeenCalledTimes(2);
    expect(mocks.fetchSurveyDefinition).not.toHaveBeenCalled();
  });

  it("Strict Modeでも一覧取得を多重実行しない", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(await screen.findByRole("button", { name: /テストアンケート/ })).toBeTruthy();
    expect(mocks.initializeLiff).toHaveBeenCalledTimes(1);
    expect(mocks.fetchSurveyList).toHaveBeenCalledTimes(1);
  });

  it("アンマウント時に進行中の一覧リクエストを中断する", async () => {
    let signal: AbortSignal | undefined;
    mocks.fetchSurveyList.mockImplementation(
      (_apiUrl: string, _token: string, receivedSignal: AbortSignal) => {
        signal = receivedSignal;
        return new Promise<SurveyListItem[]>(() => undefined);
      },
    );
    const view = render(<App />);
    await waitFor(() => expect(mocks.fetchSurveyList).toHaveBeenCalledTimes(1));

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });
});
