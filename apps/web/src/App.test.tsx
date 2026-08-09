// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  DiagnosisAnswer,
  DiagnosisDefinition,
  DiagnosisListItem,
  DiagnosisResult,
} from "./feature/diagnosis";
import { OperationError } from "./infrastructure/errors";

const mocks = vi.hoisted(() => ({
  config: {
    environment: "development" as string | undefined,
    liffId: "test-liff-id",
    apiUrl: "https://api.example.com",
  },
  initializeLiff: vi.fn(),
  getLiffIdToken: vi.fn(),
  fetchDiagnosisList: vi.fn(),
  fetchDiagnosisDefinition: vi.fn(),
  fetchDiagnosisProgress: vi.fn(),
  fetchDiagnosisResult: vi.fn(),
  saveDiagnosisAnswer: vi.fn(),
  resetDevelopmentDiagnosisData: vi.fn(),
  restoreDiagnosisProgress: vi.fn(),
  fetchProfileSummary: vi.fn(),
  fetchDevelopmentBrainItems: vi.fn(),
}));

vi.mock("./config", () => ({
  config: mocks.config,
}));
vi.mock("./feature/liff/infrastructure/liff-client", () => ({
  initializeLiff: mocks.initializeLiff,
  getLiffIdToken: mocks.getLiffIdToken,
}));
vi.mock("./feature/diagnosis/infrastructure/diagnosis-api", () => ({
  fetchDiagnosisList: mocks.fetchDiagnosisList,
  fetchDiagnosisDefinition: mocks.fetchDiagnosisDefinition,
  fetchDiagnosisProgress: mocks.fetchDiagnosisProgress,
  fetchDiagnosisResult: mocks.fetchDiagnosisResult,
  saveDiagnosisAnswer: mocks.saveDiagnosisAnswer,
  resetDevelopmentDiagnosisData: mocks.resetDevelopmentDiagnosisData,
}));
vi.mock("./feature/diagnosis/model/answers", () => ({
  restoreDiagnosisProgress: mocks.restoreDiagnosisProgress,
}));
vi.mock("./feature/profile/infrastructure/profile-api", () => ({
  fetchProfileSummary: mocks.fetchProfileSummary,
}));
vi.mock("./feature/brain/infrastructure/brain-api", () => ({
  fetchDevelopmentBrainItems: mocks.fetchDevelopmentBrainItems,
}));
vi.mock("./feature/diagnosis/presentation/components/swipe-diagnosis", () => ({
  SwipeDiagnosis: ({
    diagnosis,
    initialAnswers,
    onBack,
    onSaveAnswer,
    onComplete,
  }: {
    diagnosis: DiagnosisDefinition;
    initialAnswers?: DiagnosisAnswer[];
    onBack: () => void;
    onSaveAnswer: (answer: DiagnosisAnswer) => Promise<unknown>;
    onComplete: () => void;
  }) => (
    <div>
      <p>{`回答UI: ${diagnosis.title}`}</p>
      <p>{`復元済み: ${initialAnswers?.length ?? 0}件`}</p>
      <button type="button" onClick={onBack}>
        テスト一覧へ戻る
      </button>
      <button
        type="button"
        onClick={() =>
          void onSaveAnswer({
            kind: "answer",
            diagnosisQuestionId: "dq-1",
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
}));
vi.mock("./feature/diagnosis/presentation/components/diagnosis-result", () => ({
  DiagnosisResultView: ({ result }: { result: DiagnosisResult }) => (
    <div>{`結果UI: ${result.title} (${result.answers.length}件)`}</div>
  ),
}));

const definition: DiagnosisDefinition = {
  id: "diagnosis-1",
  title: "テスト診断",
  description: "説明",
  questions: [],
};

const result: DiagnosisResult = {
  id: "diagnosis-1",
  title: "テスト診断",
  description: "説明",
  responseStatus: "answered",
  answeredCount: 10,
  questionCount: 10,
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
  scoring: { scoringVersion: 1, balancedLabel: "中間", parameters: [] },
};

function diagnosis(overrides: Partial<DiagnosisListItem> = {}): DiagnosisListItem {
  return {
    id: "diagnosis-1",
    title: "テスト診断",
    description: "説明",
    opensAt: "2026-08-04T00:00:00.000Z",
    closesAt: null,
    displayOrder: 10,
    availability: "open",
    responseStatus: "unanswered",
    answeredCount: 0,
    questionCount: 10,
    lastAnsweredAt: null,
    ...overrides,
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    mocks.config.environment = "development";
    mocks.initializeLiff.mockResolvedValue({
      status: "ready",
      inClient: true,
      profile: { displayName: "テスト" },
    });
    mocks.getLiffIdToken.mockReturnValue("dummy.id.token");
    mocks.fetchDiagnosisList.mockResolvedValue([diagnosis()]);
    mocks.fetchDiagnosisDefinition.mockResolvedValue(definition);
    mocks.fetchDiagnosisProgress.mockResolvedValue(undefined);
    mocks.fetchDiagnosisResult.mockResolvedValue(result);
    mocks.saveDiagnosisAnswer.mockResolvedValue({
      outcome: "created",
      answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
      progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
    });
    mocks.resetDevelopmentDiagnosisData.mockResolvedValue({
      deletedResponseCount: 1,
      deletedAnswerCount: 10,
      deletedDeferredQuestionCount: 0,
      deletedSourceRecordCount: 10,
      deletedBrainItemCount: 4,
    });
    mocks.fetchProfileSummary.mockResolvedValue({
      summary: {
        generatedAt: "2026-08-08T12:00:00.000Z",
        headline: "最近の記録から、こんなあなたらしさが見えています",
        insights: [
          {
            key: "prepare",
            label: "見通しを持って動く",
            description: "説明",
            evidenceCount: 2,
            sources: ["diagnosis", "diary"],
          },
        ],
        recordCount: 2,
        diagnosisCount: 1,
        diaryCount: 1,
        latestRecordedAt: "2026-08-08T11:45:00.000Z",
      },
      nextAction: "diagnosis",
    });
    mocks.fetchDevelopmentBrainItems.mockResolvedValue({
      items: [
        {
          id: "brain-1",
          category: "memory",
          statement: "公園を散歩した",
          derivation: "ai",
          status: "active",
          createdAt: "2026-08-09T00:00:00.000Z",
          evidence: [
            {
              sourceRecordId: "source-1",
              relation: "supports",
              derivationMethod: "ai",
              generatedAt: "2026-08-09T00:00:01.000Z",
            },
          ],
        },
      ],
      truncated: false,
    });
    mocks.restoreDiagnosisProgress.mockImplementation(
      (_questions: DiagnosisDefinition["questions"], answers: DiagnosisResult["answers"]) => ({
        answers: answers.map((answer) => ({
          kind: "answer" as const,
          diagnosisQuestionId: answer.diagnosisQuestionId,
          questionId: answer.questionId,
          questionVersion: answer.questionVersion,
          choiceId: answer.choiceId,
          direction: "right" as const,
          acceptedAt: answer.acceptedAt,
        })),
        unansweredQuestions: [],
      }),
    );
  });

  it("右上からプロフィールを開き、ライトテーマへ切り替えて保存する", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを開く" }));
    expect(await screen.findByRole("heading", { name: "プロフィール" })).toBeTruthy();
    const lightTheme = screen.getByRole("radio", { name: /ライト/ });
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));

    fireEvent.click(lightTheme);

    expect((lightTheme as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("me-builder-color-theme")).toBe("light");
  });

  it("保存したライトテーマを次回表示でも復元する", async () => {
    window.localStorage.setItem("me-builder-color-theme", "light");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを開く" }));
    expect(
      ((await screen.findByRole("radio", { name: /ライト/ })) as HTMLInputElement).checked,
    ).toBe(true);
    await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));
  });

  it("ダミー候補からアバターを設定してプロフィールへ戻る", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを開く" }));
    fireEvent.click(await screen.findByRole("button", { name: /アバターを設定/ }));

    expect(await screen.findByRole("heading", { name: "アバター設定" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /外部AIサービスへ送信/ }));
    fireEvent.change(screen.getByLabelText(/画像をアップロード/), {
      target: { files: [new File(["selfie"], "selfie.png", { type: "image/png" })] },
    });
    expect((await screen.findAllByText("selfie.png")).length).toBeGreaterThan(0);
    expect(await screen.findByText("人物を確認できました")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ダミー変換を開始" }));
    fireEvent.click(screen.getByRole("button", { name: "星空を選択" }));
    fireEvent.click(screen.getByRole("button", { name: "このアバターに設定" }));

    expect(await screen.findByRole("heading", { name: "プロフィール" })).toBeTruthy();
    expect(screen.getByText("星空")).toBeTruthy();
  });

  it("プロフィールとアバター設定をブラウザ履歴で戻れる", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを開く" }));
    expect(window.location.pathname).toBe("/profile");
    expect(await screen.findByRole("dialog", { name: "プロフィール" })).toBeTruthy();
    const background = screen.getByRole("dialog", { name: "プロフィール" }).previousElementSibling;
    expect(background?.getAttribute("aria-hidden")).toBe("true");
    expect(background?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "プロフィールを閉じる" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /アバターを設定/ }));
    expect(window.location.pathname).toBe("/profile/avatar");
    expect(await screen.findByRole("dialog", { name: "アバター設定" })).toBeTruthy();

    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/profile"));
    expect(await screen.findByRole("dialog", { name: "プロフィール" })).toBeTruthy();

    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "プロフィールを開く" }));
  });

  it("/profileの直接表示を閉じるとわたしのまとめへ戻る", async () => {
    window.history.replaceState({}, "", "/profile");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "プロフィール" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "プロフィールを閉じる" }));

    expect(window.location.pathname).toBe("/me");
    expect(screen.queryByRole("heading", { name: "プロフィール" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
    expect(mocks.fetchDiagnosisList).not.toHaveBeenCalled();
  });

  it("/meでは診断・日記レコードから生成したまとめを表示し、診断一覧は取得しない", async () => {
    window.history.replaceState({}, "", "/me");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "見通しを持って動く" })).toBeTruthy();
    expect(mocks.initializeLiff).toHaveBeenCalled();
    expect(mocks.fetchProfileSummary).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      expect.any(AbortSignal),
    );
    expect(await screen.findByRole("heading", { name: "Brain Item一覧" })).toBeTruthy();
    expect(screen.getByText("公園を散歩した")).toBeTruthy();
    expect(mocks.fetchDevelopmentBrainItems).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      expect.any(AbortSignal),
    );
    expect(mocks.fetchDiagnosisList).not.toHaveBeenCalled();
  });

  it("LIFF初期化前にliff.stateへ保持された/meでもまとめ画面を表示する", async () => {
    window.history.replaceState({}, "", "/?liff.state=%2Fme");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
    expect(mocks.fetchDiagnosisList).not.toHaveBeenCalled();
  });

  it("Strict Modeでもまとめ取得を多重実行しない", async () => {
    window.history.replaceState({}, "", "/me");

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(await screen.findByRole("heading", { name: "見通しを持って動く" })).toBeTruthy();
    expect(mocks.initializeLiff).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProfileSummary).toHaveBeenCalledTimes(1);
    expect(mocks.fetchDevelopmentBrainItems).toHaveBeenCalledTimes(1);
  });

  it("productionのわたし画面ではBrain Item一覧を取得も表示もしない", async () => {
    mocks.config.environment = "production";
    window.history.replaceState({}, "", "/me");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Brain Item一覧" })).toBeNull();
    expect(mocks.fetchDevelopmentBrainItems).not.toHaveBeenCalled();
  });

  it("/diagnosisでは診断一覧を表示する", async () => {
    window.history.replaceState({}, "", "/diagnosis");

    render(<App />);

    expect(await screen.findByRole("button", { name: /テスト診断/ })).toBeTruthy();
    expect(mocks.fetchDiagnosisList).toHaveBeenCalledOnce();
  });

  it("/compatibilityでは相性一覧を表示し、診断一覧は取得しない", async () => {
    window.history.replaceState({}, "", "/compatibility");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "相性診断" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性" }).getAttribute("aria-current")).toBe("page");
    expect(mocks.fetchDiagnosisList).not.toHaveBeenCalled();
  });

  it("LIFFの招待リンクから相性の確認画面を直接表示する", async () => {
    window.history.replaceState({}, "", "/?liff.state=%2Fcompatibility%2Finvitations%2Fdemo");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "2人の相性を見てみませんか？" }),
    ).toBeTruthy();
    expect(screen.getByText("あおいさんから招待が届いています")).toBeTruthy();
    expect(mocks.fetchDiagnosisList).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it("受付中かつ未回答なら回答画面へ進み、1問ずつ保存することを表示する", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(await screen.findByText("回答UI: テスト診断")).toBeTruthy();
    expect(screen.getByText(/回答は1問ずつ保存されます/)).toBeTruthy();
    expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      "diagnosis-1",
      expect.any(AbortSignal),
    );
  });

  it("詳細取得が即時完了してもloadingを400ms表示する", async () => {
    render(<App />);
    const openDiagnosis = await screen.findByRole("button", { name: /テスト診断/ });
    vi.useFakeTimers();

    fireEvent.click(openDiagnosis);
    expect(screen.getByText("診断を読み込んでいます...")).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(399);
    });

    expect(screen.getByText("診断を読み込んでいます...")).toBeTruthy();
    expect(screen.queryByText("回答UI: テスト診断")).toBeNull();

    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();
  });

  it("dev環境では確認後に本人の回答データを全削除し、一覧を再取得する", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "回答データを全削除" }));

    await waitFor(() =>
      expect(mocks.resetDevelopmentDiagnosisData).toHaveBeenCalledWith(
        "https://api.example.com",
        "dummy.id.token",
      ),
    );
    expect(
      await screen.findByText("診断由来データを削除しました（回答・保留・Brain Item 14件）。"),
    ).toBeTruthy();
    expect(mocks.fetchDiagnosisList).toHaveBeenCalledTimes(2);
  });

  it("dev環境の回答データ削除を確認でキャンセルできる", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "回答データを全削除" }));

    expect(mocks.resetDevelopmentDiagnosisData).not.toHaveBeenCalled();
  });

  it("production環境では開発用データ操作を表示しない", async () => {
    mocks.config.environment = "production";
    render(<App />);

    await screen.findByRole("button", { name: /テスト診断/ });
    expect(screen.queryByRole("button", { name: "回答データを全削除" })).toBeNull();
  });

  it("環境変数未設定では開発用データ操作を表示しない", async () => {
    mocks.config.environment = undefined;
    render(<App />);

    await screen.findByRole("button", { name: /テスト診断/ });
    expect(screen.queryByRole("button", { name: "回答データを全削除" })).toBeNull();
  });

  it("回答UIの選択を保存APIへ接続する", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    fireEvent.click(await screen.findByRole("button", { name: "テスト回答" }));
    await waitFor(() =>
      expect(mocks.saveDiagnosisAnswer).toHaveBeenCalledWith(
        "https://api.example.com",
        "dummy.id.token",
        "diagnosis-1",
        "dq-1",
        "yes",
      ),
    );
  });

  it("全回答の保存完了後は保存済み回答を取得して結果画面へ進む", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    fireEvent.click(await screen.findByRole("button", { name: "テスト完了" }));

    expect(await screen.findByText("結果UI: テスト診断 (1件)")).toBeTruthy();
    expect(mocks.fetchDiagnosisResult).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      "diagnosis-1",
      expect.any(AbortSignal),
    );
  });

  it("受付終了かつ未回答では新規回答を始めず案内へ進む", async () => {
    const item = diagnosis({ availability: "closed" });
    mocks.fetchDiagnosisList.mockResolvedValue([item]);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(screen.getByRole("heading", { name: "この診断は受付を終了しました" })).toBeTruthy();
    expect(screen.getByText(/回答期間が終了したため/)).toBeTruthy();
    expect(screen.queryByText(/回答UI:/)).toBeNull();
  });

  it("回答途中では質問詳細と保存済み回答を取得して回答画面を再開する", async () => {
    const item = diagnosis({ responseStatus: "in-progress", answeredCount: 1 });
    mocks.fetchDiagnosisList.mockResolvedValue([item]);
    mocks.fetchDiagnosisDefinition.mockResolvedValue({
      ...definition,
      questions: [
        {
          diagnosisQuestionId: "dq-1",
          questionId: "q-1",
          questionVersion: 1,
          text: "質問",
          left: { choiceId: "no", label: "いいえ" },
          right: { choiceId: "yes", label: "はい" },
        },
      ],
    });
    mocks.fetchDiagnosisProgress.mockResolvedValue({
      ...result,
      responseStatus: "in-progress",
      answeredCount: 1,
      questionCount: 10,
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(await screen.findByText("回答UI: テスト診断")).toBeTruthy();
    expect(screen.getByText("復元済み: 1件")).toBeTruthy();
    expect(mocks.fetchDiagnosisDefinition).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      "diagnosis-1",
      expect.any(AbortSignal),
    );
    expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      "diagnosis-1",
      expect.any(AbortSignal),
    );
  });

  it("一覧が未回答のままでもサーバーに保存済みの回答があれば復元する", async () => {
    mocks.fetchDiagnosisDefinition.mockResolvedValue({
      ...definition,
      questions: [
        {
          diagnosisQuestionId: "dq-1",
          questionId: "q-1",
          questionVersion: 1,
          text: "質問",
          left: { choiceId: "no", label: "いいえ" },
          right: { choiceId: "yes", label: "はい" },
        },
      ],
    });
    mocks.fetchDiagnosisProgress.mockResolvedValue({
      ...result,
      responseStatus: "in-progress",
      answeredCount: 1,
      questionCount: 10,
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(await screen.findByText("復元済み: 1件")).toBeTruthy();
    expect(mocks.restoreDiagnosisProgress).toHaveBeenCalledOnce();
  });

  it("直前のバックグラウンド保存を待ってから現在回答を再取得する", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    mocks.saveDiagnosisAnswer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    await screen.findByText("回答UI: テスト診断");
    expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "テスト回答" }));
    fireEvent.click(screen.getByRole("button", { name: "テスト一覧へ戻る" }));
    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    await Promise.resolve();
    expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledTimes(1);

    resolveSave?.({
      outcome: "created",
      answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
      progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
    });
    await waitFor(() => expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledTimes(2));
  });

  it("受付終了した回答途中診断は再開せず案内へ進む", async () => {
    mocks.fetchDiagnosisList.mockResolvedValue([
      diagnosis({ availability: "closed", responseStatus: "in-progress", answeredCount: 1 }),
    ]);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(screen.getByRole("heading", { name: "この診断は受付を終了しました" })).toBeTruthy();
    expect(screen.getByText(/途中から再開したりすることはできません/)).toBeTruthy();
    expect(mocks.fetchDiagnosisDefinition).not.toHaveBeenCalled();
    expect(mocks.fetchDiagnosisProgress).not.toHaveBeenCalled();
    expect(mocks.fetchDiagnosisResult).not.toHaveBeenCalled();
  });

  it.each([
    diagnosis({ responseStatus: "answered", answeredCount: 10 }),
    diagnosis({ availability: "closed", responseStatus: "answered", answeredCount: 10 }),
  ])("回答済みなら受付状態にかかわらず保存済み結果を表示する", async (item) => {
    mocks.fetchDiagnosisList.mockResolvedValue([item]);
    render(<App />);

    const answeredSection = await screen.findByRole("button", { name: /回答済み.*1件/ });
    expect(answeredSection.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /テスト診断/ })).toBeNull();
    fireEvent.click(answeredSection);
    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(await screen.findByText("結果UI: テスト診断 (1件)")).toBeTruthy();
    expect(mocks.fetchDiagnosisResult).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      "diagnosis-1",
      expect.any(AbortSignal),
    );
    expect(mocks.fetchDiagnosisDefinition).not.toHaveBeenCalled();
  });

  it("FEに診断IDの定義がなくてもAPIの詳細で回答画面を開く", async () => {
    mocks.fetchDiagnosisList.mockResolvedValue([diagnosis({ id: "new-diagnosis" })]);
    mocks.fetchDiagnosisDefinition.mockResolvedValue({
      ...definition,
      id: "new-diagnosis",
      title: "API追加診断",
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(await screen.findByText("回答UI: API追加診断")).toBeTruthy();
    expect(mocks.fetchDiagnosisDefinition).toHaveBeenCalledWith(
      "https://api.example.com",
      "dummy.id.token",
      "new-diagnosis",
      expect.any(AbortSignal),
    );
  });

  it.each([
    {
      code: "DIAGNOSIS_UNAVAILABLE",
      heading: "この診断は現在のアプリでは未対応です",
    },
    {
      code: "DIAGNOSIS_CLOSED",
      heading: "この診断は受付を終了しました",
    },
  ])("詳細取得の$codeを対応する案内へ変換する", async ({ code, heading }) => {
    mocks.fetchDiagnosisDefinition.mockRejectedValue(new OperationError("detail error", { code }));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
  });

  it("一覧取得失敗後の再試行では初期化済みLIFFを再利用する", async () => {
    mocks.fetchDiagnosisList
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([diagnosis()]);
    render(<App />);

    const retry = await screen.findByRole("button", { name: "再試行" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(await screen.findByRole("button", { name: /テスト診断/ })).toBeTruthy();
    expect(mocks.initializeLiff).toHaveBeenCalledTimes(1);
    expect(mocks.fetchDiagnosisList).toHaveBeenCalledTimes(2);
    expect(mocks.fetchDiagnosisDefinition).not.toHaveBeenCalled();
  });

  it("Strict Modeでも一覧取得を多重実行しない", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(await screen.findByRole("button", { name: /テスト診断/ })).toBeTruthy();
    expect(mocks.initializeLiff).toHaveBeenCalledTimes(1);
    expect(mocks.fetchDiagnosisList).toHaveBeenCalledTimes(1);
  });

  it("アンマウント時に進行中の一覧リクエストを中断する", async () => {
    let signal: AbortSignal | undefined;
    mocks.fetchDiagnosisList.mockImplementation(
      (_apiUrl: string, _token: string, receivedSignal: AbortSignal) => {
        signal = receivedSignal;
        return new Promise<DiagnosisListItem[]>(() => undefined);
      },
    );
    const view = render(<App />);
    await waitFor(() => expect(mocks.fetchDiagnosisList).toHaveBeenCalledTimes(1));

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });
});
