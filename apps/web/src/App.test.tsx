// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { SurveyAnswer, SurveyDefinition, SurveyListItem } from "./feature/survey";
import { OperationError } from "./infrastructure/errors";

const mocks = vi.hoisted(() => ({
  initializeLiff: vi.fn(),
  getLiffIdToken: vi.fn(),
  fetchSurveyList: vi.fn(),
  fetchSurveyDefinition: vi.fn(),
  saveSurveyAnswer: vi.fn(),
}));

vi.mock("./config", () => ({
  config: { liffId: "test-liff-id", apiUrl: "https://api.example.com" },
}));
vi.mock("./feature/liff", () => ({
  initializeLiff: mocks.initializeLiff,
  getLiffIdToken: mocks.getLiffIdToken,
}));
vi.mock("./feature/survey", () => ({
  fetchSurveyList: mocks.fetchSurveyList,
  fetchSurveyDefinition: mocks.fetchSurveyDefinition,
  saveSurveyAnswer: mocks.saveSurveyAnswer,
  SwipeSurvey: ({
    survey,
    onSaveAnswer,
  }: {
    survey: SurveyDefinition;
    onSaveAnswer: (answer: SurveyAnswer) => Promise<unknown>;
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
    </div>
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
    mocks.initializeLiff.mockResolvedValue({
      status: "ready",
      inClient: true,
      profile: { displayName: "テスト" },
    });
    mocks.getLiffIdToken.mockReturnValue("dummy.id.token");
    mocks.fetchSurveyList.mockResolvedValue([survey()]);
    mocks.fetchSurveyDefinition.mockResolvedValue(definition);
    mocks.saveSurveyAnswer.mockResolvedValue({
      outcome: "created",
      answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
      progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
    });
  });

  afterEach(() => cleanup());

  it("受付中かつ未回答なら回答画面へ進み、1問ずつ保存することを表示する", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テストアンケート/ }));

    expect(await screen.findByText("回答UI: テストアンケート")).toBeTruthy();
    expect(screen.getByText(/回答は1問ずつ保存されます/)).toBeTruthy();
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

  it.each([
    {
      name: "受付終了かつ未回答",
      item: survey({ availability: "closed" }),
      heading: "このアンケートは受付を終了しました",
    },
    {
      name: "回答済み",
      item: survey({ responseStatus: "answered", answeredCount: 10 }),
      heading: "回答内容画面は現在準備中です",
    },
    {
      name: "受付終了後の回答済み",
      item: survey({
        availability: "closed",
        responseStatus: "answered",
        answeredCount: 10,
      }),
      heading: "回答内容画面は現在準備中です",
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
