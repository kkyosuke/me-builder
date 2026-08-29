// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  DiagnosisAnswer,
  DiagnosisDefinition,
  DiagnosisListItem,
  DiagnosisResult,
} from "./feature/diagnosis";
import { diagnosisDetailIdFromHistoryState } from "./feature/diagnosis/model/diagnosis-navigation";
import type { ProfileEntitlement } from "./feature/profile-settings/model/entitlement";
import { ProfileSummaryGenerationUnavailableError } from "./feature/profile/model/profile-summary";
import { OperationError } from "./infrastructure/errors";

const mocks = vi.hoisted(() => ({
  config: {
    environment: "development" as string | undefined,
    liffId: "test-liff-id",
    apiUrl: "https://api.example.com",
  },
  initializeLiffForAuthExchange: vi.fn(),
  readLiffAuthExchangeCredential: vi.fn(),
  isInLiffClient: vi.fn(),
  openLiffExternalWindow: vi.fn(),
  authState: {
    status: "authenticated" as const,
    profile: { displayName: "テスト", pictureUrl: undefined as string | undefined },
    role: "user" as "user" | "admin",
    revision: 1,
  },
  retryAuthSession: vi.fn(),
  fetchAccountProfile: vi.fn(),
  fetchProfileEntitlement: vi.fn(),
  saveAccountAvatar: vi.fn(),
  deleteAccountAvatar: vi.fn(),
  fetchDiagnosisList: vi.fn(),
  fetchDiagnosisDefinition: vi.fn(),
  fetchDiagnosisProgress: vi.fn(),
  fetchDiagnosisResult: vi.fn(),
  saveDiagnosisAnswer: vi.fn(),
  resetDevelopmentAccountData: vi.fn(),
  restoreDiagnosisProgress: vi.fn(),
  fetchProfileSummary: vi.fn(),
  fetchProfileProgression: vi.fn(),
  requestProfileSummaryGeneration: vi.fn(),
  fetchDevelopmentBrainItems: vi.fn(),
  normalizeAvatarImage: vi.fn(),
  fetchCompatibilityShareConsent: vi.fn(),
  fetchCompatibilityShareContent: vi.fn(),
  fetchCompatibilityInvitation: vi.fn(),
  fetchCompatibilityRelationships: vi.fn(),
  fetchCompatibilityRelationship: vi.fn(),
  acceptCompatibilityInvitation: vi.fn(),
  issueCompatibilityInvitation: vi.fn(),
  cancelCompatibilityInvitation: vi.fn(),
  endCompatibilityRelationship: vi.fn(),
  fetchAdminAccounts: vi.fn(),
  fetchAdminStatistics: vi.fn(),
}));

vi.mock("./config", () => ({
  config: mocks.config,
}));
vi.mock("./feature/legal", () => ({
  ServiceTermsGate: ({ children }: { children: ReactNode }) => children,
  ServiceTermsAcceptanceHistory: () => null,
}));
vi.mock("./feature/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./feature/auth")>()),
  AuthSessionProvider: ({ children }: { children: ReactNode }) => children,
  useAuthSession: () => ({ state: mocks.authState, retry: mocks.retryAuthSession }),
}));
vi.mock("./feature/liff", () => ({
  isInLiffClient: mocks.isInLiffClient,
  openLiffExternalWindow: mocks.openLiffExternalWindow,
}));
vi.mock("./feature/liff/infrastructure/liff-client", () => ({
  initializeLiffForAuthExchange: mocks.initializeLiffForAuthExchange,
  readLiffAuthExchangeCredential: mocks.readLiffAuthExchangeCredential,
  isInLiffClient: mocks.isInLiffClient,
  openLiffExternalWindow: mocks.openLiffExternalWindow,
}));
vi.mock("./feature/profile-settings/infrastructure/profile-api", () => ({
  fetchAccountProfile: mocks.fetchAccountProfile,
  saveAccountAvatar: mocks.saveAccountAvatar,
  deleteAccountAvatar: mocks.deleteAccountAvatar,
}));
vi.mock("./feature/profile-settings/infrastructure/entitlement-api", () => ({
  fetchProfileEntitlement: mocks.fetchProfileEntitlement,
}));
vi.mock("./feature/profile-settings/infrastructure/development-account-data-api", () => ({
  resetDevelopmentAccountData: mocks.resetDevelopmentAccountData,
}));
vi.mock("./feature/diagnosis/infrastructure/diagnosis-api", () => ({
  fetchDiagnosisList: mocks.fetchDiagnosisList,
  fetchDiagnosisDefinition: mocks.fetchDiagnosisDefinition,
  fetchDiagnosisProgress: mocks.fetchDiagnosisProgress,
  fetchDiagnosisResult: mocks.fetchDiagnosisResult,
  saveDiagnosisAnswer: mocks.saveDiagnosisAnswer,
}));
vi.mock("./feature/diagnosis/model/answers", () => ({
  restoreDiagnosisProgress: mocks.restoreDiagnosisProgress,
}));
vi.mock("./feature/profile/infrastructure/profile-api", () => ({
  fetchProfileSummary: mocks.fetchProfileSummary,
  requestProfileSummaryGeneration: mocks.requestProfileSummaryGeneration,
}));
vi.mock("./feature/profile/infrastructure/progression-api", () => ({
  fetchProfileProgression: mocks.fetchProfileProgression,
}));
vi.mock("./feature/brain/infrastructure/brain-api", () => ({
  fetchDevelopmentBrainItems: mocks.fetchDevelopmentBrainItems,
}));
vi.mock("./feature/profile-settings/model/normalize-avatar-image", () => ({
  normalizeAvatarImage: mocks.normalizeAvatarImage,
}));
vi.mock("./feature/compatibility/infrastructure/compatibility-api", () => ({
  fetchCompatibilityShareConsent: mocks.fetchCompatibilityShareConsent,
  fetchCompatibilityShareContent: mocks.fetchCompatibilityShareContent,
  fetchCompatibilityInvitation: mocks.fetchCompatibilityInvitation,
  fetchCompatibilityRelationships: mocks.fetchCompatibilityRelationships,
  fetchCompatibilityRelationship: mocks.fetchCompatibilityRelationship,
  acceptCompatibilityInvitation: mocks.acceptCompatibilityInvitation,
  issueCompatibilityInvitation: mocks.issueCompatibilityInvitation,
  cancelCompatibilityInvitation: mocks.cancelCompatibilityInvitation,
  endCompatibilityRelationship: mocks.endCompatibilityRelationship,
}));
vi.mock("./feature/admin/infrastructure/admin-api", () => ({
  fetchAdminAccounts: mocks.fetchAdminAccounts,
  fetchAdminStatistics: mocks.fetchAdminStatistics,
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
        onClick={() => {
          void onSaveAnswer({
            kind: "answer",
            diagnosisQuestionId: "dq-1",
            questionId: "q-1",
            questionVersion: 1,
            choiceId: "yes",
            direction: "right",
            acceptedAt: "2026-08-05T00:00:00.000Z",
          }).catch(() => undefined);
        }}
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
  relationshipCategory: "general",
  questions: [],
};

const result: DiagnosisResult = {
  id: "diagnosis-1",
  title: "テスト診断",
  description: "説明",
  relationshipCategory: "general",
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

const profileEntitlement: ProfileEntitlement = {
  status: "free",
  plan: "free",
  source: "free",
  effectiveAt: "2026-08-01T00:00:00.000Z",
  availableUntil: null,
  aiReply: {
    limit: 10,
    used: 0,
    reserved: 0,
    remaining: 10,
    periodStartsAt: "2026-08-01T00:00:00.000Z",
    resetsAt: "2026-09-01T00:00:00.000Z",
  },
};

function diagnosis(overrides: Partial<DiagnosisListItem> = {}): DiagnosisListItem {
  return {
    id: "diagnosis-1",
    title: "テスト診断",
    description: "説明",
    relationshipCategory: "general",
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
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => localStorageValues.clear(),
        getItem: (key: string) => localStorageValues.get(key) ?? null,
        setItem: (key: string, value: string) => localStorageValues.set(key, value),
      },
    });
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    mocks.config.environment = "development";
    mocks.authState = {
      status: "authenticated",
      profile: { displayName: "テスト", pictureUrl: undefined },
      role: "user",
      revision: 1,
    };
    mocks.initializeLiffForAuthExchange.mockResolvedValue({
      status: "ready",
      inClient: true,
    });
    mocks.readLiffAuthExchangeCredential.mockReturnValue("dummy.id.token");
    mocks.isInLiffClient.mockReturnValue(true);
    mocks.openLiffExternalWindow.mockReturnValue(true);
    mocks.fetchAccountProfile.mockResolvedValue({
      role: "user",
      displayName: "テスト",
      avatar: null,
    });
    mocks.fetchProfileEntitlement.mockResolvedValue(profileEntitlement);
    mocks.fetchProfileProgression.mockResolvedValue({
      level: 1,
      growthValue: 0,
      currentLevelThreshold: 0,
      nextLevelThreshold: 5,
      collectedPieces: 0,
      activePieces: 0,
      categoryCount: 0,
      calculationVersion: 1,
      highestLevel: 1,
      isProcessing: false,
      recentChanges: [],
      milestoneCards: [],
    });
    mocks.saveAccountAvatar.mockImplementation(
      async (_apiUrl: string, nextAvatar: { dataUrl: string }) => ({
        role: "user",
        displayName: "テスト",
        avatar: {
          source: "uploaded",
          url: nextAvatar.dataUrl,
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      }),
    );
    mocks.deleteAccountAvatar.mockResolvedValue({
      role: "user",
      displayName: "テスト",
      avatar: null,
    });
    mocks.fetchDiagnosisList.mockResolvedValue([diagnosis()]);
    mocks.fetchDiagnosisDefinition.mockResolvedValue(definition);
    mocks.fetchDiagnosisProgress.mockResolvedValue(undefined);
    mocks.fetchDiagnosisResult.mockResolvedValue(result);
    mocks.saveDiagnosisAnswer.mockResolvedValue({
      outcome: "created",
      answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
      progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
    });
    mocks.resetDevelopmentAccountData.mockResolvedValue({
      deletedDiagnosisResponseCount: 1,
      deletedConversationSessionCount: 2,
      deletedSourceRecordCount: 10,
      deletedBrainItemCount: 4,
      deletedProfileSummaryVersionCount: 1,
      scheduledVectorDeletionCount: 4,
    });
    const profileSummary = {
      generatedAt: "2026-08-08T12:00:00.000Z",
      headline: "最近の記録から、こんなあなたらしさが見えています",
      insights: [
        {
          key: "prepare",
          label: "見通しを持って動く",
          description: "説明",
          evidenceCount: 2,
          sources: ["diagnosis", "diary"] as const,
        },
      ],
      recordCount: 2,
      diagnosisCount: 1,
      diaryCount: 1,
      latestRecordedAt: "2026-08-08T11:45:00.000Z",
    } as const;
    mocks.fetchProfileSummary.mockResolvedValue({
      summary: profileSummary,
      versions: [
        {
          id: "version-1",
          sequence: 2,
          generatedAt: profileSummary.generatedAt,
          isLatest: true,
          generationMethod: "ai",
          summary: profileSummary,
        },
        {
          id: "version-previous",
          sequence: 1,
          generatedAt: "2026-08-01T12:00:00.000Z",
          isLatest: false,
          generationMethod: "ai",
          summary: {
            ...profileSummary,
            generatedAt: "2026-08-01T12:00:00.000Z",
            headline: "過去の記録から見えたあなたらしさ",
          },
        },
      ],
      availableDataCounts: { diagnosis: 2, diary: 5 },
      generation: { status: "idle", canRegenerate: false, reasons: [] },
      nextAction: "diagnosis",
    });
    mocks.requestProfileSummaryGeneration.mockResolvedValue({
      generationId: "generation-1",
      status: "queued",
      created: true,
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
          firstObservedAt: "2026-08-01T00:00:00.000Z",
          lastObservedAt: "2026-08-09T00:00:00.000Z",
          vectorSync: {
            status: "applied",
            operation: "upsert",
            attemptCount: 1,
            hasEntry: true,
            entryRevision: 1,
          },
          evidence: [
            {
              sourceRecordId: "source-1",
              relation: "supports",
              derivationMethod: "ai",
              generatedAt: "2026-08-09T00:00:01.000Z",
              recordedAt: "2026-08-09T00:00:00.000Z",
            },
          ],
        },
      ],
      truncated: false,
    });
    mocks.normalizeAvatarImage.mockImplementation(async (file: File) => ({
      kind: "uploaded",
      dataUrl: `data:${file.type};base64,normalized`,
      fileName: file.name,
    }));
    mocks.fetchCompatibilityShareConsent.mockResolvedValue({
      displayName: "テスト",
      avatarUrl: null,
      canShare: true,
      blockingReasons: [],
      nextAction: null,
    });
    mocks.fetchCompatibilityShareContent.mockResolvedValue({
      relationshipCategory: "partner",
      aboutMe: null,
      themes: [],
      nextAction: null,
    });
    mocks.fetchCompatibilityInvitation.mockResolvedValue({
      relationshipCategory: "friend",
      inviter: { displayName: "あおい", avatarUrl: null },
      recipient: { displayName: "テスト", avatarUrl: null },
      expiresAt: "2026-08-26T00:00:00.000Z",
      canAccept: true,
      blockingReasons: [],
      nextAction: "diagnosis",
    });
    mocks.fetchCompatibilityRelationships.mockResolvedValue({ items: [] });
    mocks.acceptCompatibilityInvitation.mockResolvedValue({
      relationshipId: "1".repeat(64),
      status: "accepted",
    });
    mocks.cancelCompatibilityInvitation.mockResolvedValue(undefined);
    mocks.endCompatibilityRelationship.mockResolvedValue(undefined);
    mocks.fetchAdminAccounts.mockResolvedValue({ accounts: [], total: 0, nextCursor: null });
    mocks.fetchAdminStatistics.mockResolvedValue({});
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

  it("未設定時はLINEプロフィール画像を右上アイコンに表示する", async () => {
    const linePictureUrl = "https://example.com/line-profile.jpg";
    mocks.authState.profile.pictureUrl = linePictureUrl;
    mocks.fetchAccountProfile.mockResolvedValue({
      role: "user",
      displayName: "テスト",
      avatar: { source: "line", url: linePictureUrl, updatedAt: null },
    });

    render(<App />);

    const profileButton = await screen.findByRole("button", { name: "プロフィールを開く" });
    await waitFor(() =>
      expect(profileButton.querySelector("img")?.getAttribute("src")).toBe(linePictureUrl),
    );
  });

  it("確定した現在Planを右上のプロフィールバッジに表示する", async () => {
    mocks.fetchProfileEntitlement.mockResolvedValue({
      ...profileEntitlement,
      status: "active",
      plan: "full",
      source: "subscription",
    });

    render(<App />);

    const profileButton = screen.getByRole("button", { name: "プロフィールを開く" });
    await waitFor(() =>
      expect(
        [...profileButton.querySelectorAll('[aria-hidden="true"]')].some(
          (element) => element.textContent === "FULL",
        ),
      ).toBe(true),
    );
    expect(screen.getByText("現在のプラン: Full")).toBeTruthy();
  });

  it("Planを確認できないsafe-defaultへ変わったときは既存のバッジを取り除く", async () => {
    let resolveSafeDefault!: (entitlement: ProfileEntitlement) => void;
    const safeDefault = new Promise<ProfileEntitlement>((resolve) => {
      resolveSafeDefault = resolve;
    });
    mocks.fetchProfileEntitlement
      .mockResolvedValueOnce({
        ...profileEntitlement,
        status: "active",
        plan: "full",
        source: "subscription",
      })
      .mockReturnValueOnce(safeDefault);
    const { rerender } = render(<App />);

    expect(await screen.findByText("現在のプラン: Full")).toBeTruthy();

    mocks.authState = { ...mocks.authState, revision: 2 };
    rerender(<App />);
    await waitFor(() => expect(mocks.fetchProfileEntitlement).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveSafeDefault({ ...profileEntitlement, status: "safe-default" });
      await safeDefault;
    });

    const profileButton = screen.getByRole("button", { name: "プロフィールを開く" });
    expect(profileButton.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText("現在のプラン: Free")).toBeNull();
    expect(screen.queryByText("現在のプラン: Full")).toBeNull();
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

  it("プロフィールで文字サイズを切り替えて保存する", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを開く" }));
    const smallFontSize = await screen.findByRole("radio", { name: "小" });

    fireEvent.click(smallFontSize);

    expect((smallFontSize as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.classList.contains("font-size-small")).toBe(true);
    expect(window.localStorage.getItem("me-builder-font-size")).toBe("small");
  });

  it("管理者のプロフィールにだけ管理者画面へのリンクを表示する", async () => {
    mocks.authState.role = "admin";
    mocks.fetchAccountProfile.mockResolvedValue({
      role: "admin",
      displayName: "管理者",
      avatar: null,
    });
    render(<App />);
    const startingDiagnosis = await screen.findByText("テスト診断");

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを開く" }));

    const adminLink = await screen.findByRole("link", { name: /管理者画面を開く/ });
    expect(adminLink.getAttribute("href")).toBe("/admin");
    expect(mocks.fetchAccountProfile).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.any(AbortSignal),
    );

    fireEvent.click(adminLink);
    expect(window.location.pathname).toBe("/admin");
    expect(screen.queryByRole("dialog", { name: "プロフィール" })).toBeNull();

    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/profile"));
    expect(await screen.findByRole("dialog", { name: "プロフィール" })).toBeTruthy();
    expect(startingDiagnosis.isConnected).toBe(true);
  });

  it("管理画面のセッション切替で前アカウントの一覧を破棄して再取得する", async () => {
    mocks.authState.role = "admin";
    mocks.fetchAdminAccounts
      .mockResolvedValueOnce({
        accounts: [
          {
            adminReference: "account_0123456789abcdef01234567",
            role: "user",
            status: "active",
            createdAt: "2026-08-01T00:00:00.000Z",
            lastActivityAt: "2026-08-01T01:00:00.000Z",
            plan: "free",
            progression: { status: "pending" },
          },
        ],
        total: 1,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        accounts: [
          {
            adminReference: "account_89abcdef0123456789abcdef",
            role: "user",
            status: "active",
            createdAt: "2026-08-02T00:00:00.000Z",
            lastActivityAt: "2026-08-02T01:00:00.000Z",
            plan: "free",
            progression: { status: "pending" },
          },
        ],
        total: 1,
        nextCursor: null,
      });
    window.history.replaceState({}, "", "/admin");
    const view = render(<App />);

    expect((await screen.findAllByText("account_0123456789abcdef01234567")).length).toBeGreaterThan(
      0,
    );

    mocks.authState = {
      status: "authenticated",
      profile: { displayName: "別管理者", pictureUrl: undefined },
      role: "admin",
      revision: 2,
    };
    view.rerender(<App />);

    expect((await screen.findAllByText("account_89abcdef0123456789abcdef")).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryAllByText("account_0123456789abcdef01234567")).toHaveLength(0);
    expect(mocks.fetchAdminAccounts).toHaveBeenCalledTimes(2);
  });

  it("LINE画像を表示し、選んだ画像をアバターに設定してプロフィールへ戻る", async () => {
    const linePictureUrl = "https://example.com/line-profile.jpg";
    mocks.authState.profile.pictureUrl = linePictureUrl;
    mocks.fetchAccountProfile.mockResolvedValue({
      role: "user",
      displayName: "テスト",
      avatar: { source: "line", url: linePictureUrl, updatedAt: null },
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを開く" }));
    expect(await screen.findByText("LINEのプロフィール画像")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /アバターを変更/ }));

    expect(await screen.findByRole("heading", { name: "アバターを変更" })).toBeTruthy();
    expect(screen.getByText("LINEのプロフィール画像を表示しています。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("画像を選ぶ"), {
      target: { files: [new File(["selfie"], "selfie.png", { type: "image/png" })] },
    });
    expect(await screen.findByText("設定するアバター")).toBeTruthy();
    expect(screen.queryByText("selfie.png")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "この画像を保存" }));

    expect(await screen.findByRole("heading", { name: "プロフィール" })).toBeTruthy();
    expect(mocks.saveAccountAvatar).toHaveBeenCalledWith(
      "https://api.example.com",
      {
        kind: "uploaded",
        dataUrl: "data:image/png;base64,normalized",
        fileName: "selfie.png",
      },
      expect.any(AbortSignal),
    );
    expect(screen.getByText("設定した画像")).toBeTruthy();
    expect(screen.queryByText("selfie.png")).toBeNull();
    expect(screen.queryByText(/人物を確認/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを閉じる" }));
    const profileButton = await screen.findByRole("button", { name: "プロフィールを開く" });
    expect(profileButton.querySelector("img")?.getAttribute("src")).toMatch(
      /^data:image\/png;base64,normalized$/,
    );
  });

  it("保存済み画像をプロフィールAPIから取得して右上アイコンへ復元する", async () => {
    mocks.fetchAccountProfile.mockResolvedValue({
      role: "user",
      displayName: "テスト",
      avatar: {
        source: "uploaded",
        url: "data:image/png;base64,c2F2ZWQ=",
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    });

    render(<App />);

    const profileButton = await screen.findByRole("button", { name: "プロフィールを開く" });
    await waitFor(() =>
      expect(profileButton.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,c2F2ZWQ=",
      ),
    );
  });

  it("主ナビゲーションの切り替えでプロフィール画像と取得済み状態を維持する", async () => {
    window.history.replaceState({}, "", "/diagnosis");
    mocks.fetchAccountProfile.mockResolvedValue({
      role: "user",
      displayName: "テスト",
      avatar: {
        source: "uploaded",
        url: "data:image/png;base64,c2F2ZWQ=",
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    });

    render(<App />);

    const profileButton = await screen.findByRole("button", { name: "プロフィールを開く" });
    await waitFor(() =>
      expect(profileButton.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,c2F2ZWQ=",
      ),
    );
    expect(mocks.fetchAccountProfile).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole("link", { name: "わたし" }));

    await waitFor(() => expect(window.location.pathname).toBe("/me"));
    expect(profileButton.isConnected).toBe(true);
    expect(profileButton.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,c2F2ZWQ=",
    );
    expect(mocks.fetchAccountProfile).toHaveBeenCalledTimes(1);
  });

  it("主画面ごとのスクロール位置へ戻し、初めての画面では先頭を表示する", async () => {
    window.history.replaceState({}, "", "/diagnosis");
    let scrollY = 480;
    const scrollYSpy = vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    const scrollToSpy = vi.mocked(window.scrollTo).mockImplementation((_x, y) => {
      scrollY = y ?? scrollY;
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "わたし" }));

    await waitFor(() => expect(window.location.pathname).toBe("/me"));
    const profileHeading = await screen.findByRole(
      "heading",
      { name: "わたしのまとめ" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(document.activeElement).toBe(profileHeading));
    expect(scrollToSpy).toHaveBeenLastCalledWith(0, 0);

    scrollY = 260;
    fireEvent.click(await screen.findByRole("link", { name: "診断" }));

    await waitFor(() => expect(window.location.pathname).toBe("/diagnosis"));
    const diagnosisHeading = await screen.findByRole(
      "heading",
      { name: "わたしの診断" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(document.activeElement).toBe(diagnosisHeading));
    expect(scrollToSpy).toHaveBeenLastCalledWith(0, 480);

    scrollY = 720;
    fireEvent.click(await screen.findByRole("link", { name: "わたし" }));

    await waitFor(() => expect(window.location.pathname).toBe("/me"));
    expect(scrollToSpy).toHaveBeenLastCalledWith(0, 260);

    scrollY = 340;
    fireEvent.click(await screen.findByRole("link", { name: "相性" }));

    await waitFor(() => expect(window.location.pathname).toBe("/compatibility"));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "ふたりの見取り図" }),
      ),
    );
    expect(scrollToSpy).toHaveBeenLastCalledWith(0, 0);

    scrollY = 190;
    fireEvent.click(await screen.findByRole("link", { name: "わたし" }));

    await waitFor(() => expect(window.location.pathname).toBe("/me"));
    expect(scrollToSpy).toHaveBeenLastCalledWith(0, 340);
    scrollYSpy.mockRestore();
  });

  it("保存画像の取得前にLINE画像を先に表示しない", async () => {
    const linePictureUrl = "https://example.com/line-profile.jpg";
    let resolveProfile: ((profile: unknown) => void) | undefined;
    mocks.authState.profile.pictureUrl = linePictureUrl;
    mocks.fetchAccountProfile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProfile = resolve;
      }),
    );

    render(<App />);

    const profileButton = await screen.findByRole("button", { name: "プロフィールを開く" });
    await waitFor(() => expect(mocks.fetchAccountProfile).toHaveBeenCalled());
    expect(profileButton.querySelector("img")).toBeNull();
    expect(document.querySelector(`img[src="${linePictureUrl}"]`)).toBeNull();

    await act(async () => {
      resolveProfile?.({
        role: "user",
        displayName: "テスト",
        avatar: {
          source: "uploaded",
          url: "data:image/png;base64,c2F2ZWQ=",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      });
    });

    await waitFor(() =>
      expect(profileButton.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,c2F2ZWQ=",
      ),
    );
  });

  it("保存済み画像を削除してLINE画像へ戻す", async () => {
    const linePictureUrl = "https://example.com/line-profile.jpg";
    mocks.authState.profile.pictureUrl = linePictureUrl;
    mocks.fetchAccountProfile.mockResolvedValue({
      role: "user",
      displayName: "テスト",
      avatar: {
        source: "uploaded",
        url: "data:image/png;base64,c2F2ZWQ=",
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    });
    mocks.deleteAccountAvatar.mockResolvedValue({
      role: "user",
      displayName: "テスト",
      avatar: { source: "line", url: linePictureUrl, updatedAt: null },
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを開く" }));
    fireEvent.click(await screen.findByRole("button", { name: /アバターを変更/ }));
    fireEvent.click(await screen.findByRole("button", { name: "LINEの画像に戻す" }));

    await waitFor(() =>
      expect(mocks.deleteAccountAvatar).toHaveBeenCalledWith(
        "https://api.example.com",
        expect.any(AbortSignal),
      ),
    );
    expect(await screen.findByText("LINEのプロフィール画像")).toBeTruthy();
  });

  it("アプリセッション切替時に前アカウントのプロフィール表示と履歴を破棄する", async () => {
    const previousAvatar = "data:image/png;base64,cHJldmlvdXM=";
    const nextAvatar = "data:image/png;base64,bmV4dA==";
    mocks.fetchAccountProfile
      .mockResolvedValueOnce({
        role: "user",
        displayName: "切替前",
        avatar: {
          source: "uploaded",
          url: previousAvatar,
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        role: "user",
        displayName: "切替後",
        avatar: {
          source: "uploaded",
          url: nextAvatar,
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
      });
    const view = render(<App />);

    const profileButton = await screen.findByRole("button", { name: "プロフィールを開く" });
    await waitFor(() =>
      expect(profileButton.querySelector("img")?.getAttribute("src")).toBe(previousAvatar),
    );
    fireEvent.click(profileButton);
    expect(await screen.findByRole("dialog", { name: "プロフィール" })).toBeTruthy();
    expect(window.location.pathname).toBe("/profile");

    mocks.authState = {
      status: "authenticated",
      profile: { displayName: "別アカウント", pictureUrl: undefined },
      role: "user",
      revision: 2,
    };
    view.rerender(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.queryByRole("dialog", { name: "プロフィール" })).toBeNull();
    expect(document.querySelector(`img[src="${previousAvatar}"]`)).toBeNull();
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "プロフィールを開く" })
          .querySelector("img")
          ?.getAttribute("src"),
      ).toBe(nextAvatar),
    );
    expect(mocks.fetchAccountProfile).toHaveBeenCalledTimes(2);
  });

  it("session切替前のアバター保存結果で新Accountの表示を上書きしない", async () => {
    const previousAvatar = "data:image/png;base64,b2xk";
    const nextAvatar = "data:image/png;base64,bmV3";
    let resolveDeletion: ((profile: unknown) => void) | undefined;
    mocks.fetchAccountProfile
      .mockResolvedValueOnce({
        role: "user",
        displayName: "切替前",
        avatar: { source: "uploaded", url: previousAvatar, updatedAt: null },
      })
      .mockResolvedValueOnce({
        role: "user",
        displayName: "切替後",
        avatar: { source: "uploaded", url: nextAvatar, updatedAt: null },
      });
    mocks.deleteAccountAvatar.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDeletion = resolve;
      }),
    );
    const view = render(<App />);

    const profileButton = await screen.findByRole("button", { name: "プロフィールを開く" });
    await waitFor(() =>
      expect(profileButton.querySelector("img")?.getAttribute("src")).toBe(previousAvatar),
    );
    fireEvent.click(profileButton);
    fireEvent.click(await screen.findByRole("button", { name: /アバターを変更/ }));
    fireEvent.click(await screen.findByRole("button", { name: "現在の画像を削除" }));
    await waitFor(() => expect(mocks.deleteAccountAvatar).toHaveBeenCalledTimes(1));

    mocks.authState = {
      status: "authenticated",
      profile: { displayName: "別アカウント", pictureUrl: undefined },
      role: "user",
      revision: 2,
    };
    view.rerender(<App />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "プロフィールを開く" })
          .querySelector("img")
          ?.getAttribute("src"),
      ).toBe(nextAvatar),
    );

    await act(async () => {
      resolveDeletion?.({
        role: "user",
        displayName: "切替前",
        avatar: null,
      });
    });
    expect(
      screen
        .getByRole("button", { name: "プロフィールを開く" })
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe(nextAvatar);
  });

  it("ファミリー招待表示中のセッション切替で招待tokenを履歴ごと破棄する", async () => {
    window.history.replaceState({}, "", "/profile/family?token=family.invitation.secret");
    const view = render(<App />);

    expect(
      await screen.findByRole("heading", { name: "ファミリーパック" }, { timeout: 5_000 }),
    ).toBeTruthy();
    expect(window.location.search).toContain("family.invitation.secret");

    mocks.authState = {
      status: "authenticated",
      profile: { displayName: "別アカウント", pictureUrl: undefined },
      role: "user",
      revision: 2,
    };
    view.rerender(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/me"));
    expect(window.location.search).toBe("");
    expect(screen.queryByRole("heading", { name: "ファミリーパック" })).toBeNull();
  });

  it("プロフィール取得失敗を表示して再試行できる", async () => {
    mocks.fetchAccountProfile
      .mockRejectedValueOnce(new Error("プロフィールの取得に失敗しました。再試行してください。"))
      .mockResolvedValue({ role: "user", displayName: "テスト", avatar: null });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを開く" }));
    expect((await screen.findByRole("alert")).textContent).toContain("プロフィールの取得に失敗");
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));

    expect(await screen.findByRole("button", { name: /アバターを設定/ })).toBeTruthy();
    expect(mocks.fetchAccountProfile).toHaveBeenCalledTimes(2);
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
    expect(await screen.findByRole("dialog", { name: "アバターを変更" })).toBeTruthy();
    const inactiveProfile = document.querySelector<HTMLDialogElement>(
      'dialog[aria-labelledby="profile-settings-title"]',
    );
    expect(inactiveProfile).not.toBeNull();
    expect(inactiveProfile?.getAttribute("aria-hidden")).toBe("true");
    expect(inactiveProfile?.hasAttribute("inert")).toBe(true);

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

  it("SSO Identity連携のキャンセル結果を表示してURL markerだけを消費する", async () => {
    window.history.replaceState({}, "", "/profile?from=settings&sso=cancelled#login-method");

    render(<App />);

    expect(await screen.findByText("Google連携をキャンセルしました。")).toBeTruthy();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/profile?from=settings#login-method",
    );
  });

  it("/meでは診断・日記レコードから生成したまとめだけを表示する", async () => {
    window.history.replaceState({}, "", "/me");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "見通しを持って動く" })).toBeTruthy();
    expect(mocks.fetchProfileSummary).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.any(AbortSignal),
    );
    expect(screen.queryByRole("heading", { name: "Brain Item一覧" })).toBeNull();
    expect(mocks.fetchDevelopmentBrainItems).not.toHaveBeenCalled();
    expect(mocks.fetchDiagnosisList).not.toHaveBeenCalled();
  });

  it("開発環境ではプロフィールからBrain Item一覧の別ページを開いて戻れる", async () => {
    mocks.authState.role = "admin";
    window.history.replaceState({}, "", "/me");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "プロフィールを開く" }));
    const brainItemsLink = await screen.findByRole("link", { name: /Brain Item一覧を開く/ });
    fireEvent.click(brainItemsLink);

    expect(window.location.pathname).toBe("/profile/brain-items");
    expect(await screen.findByRole("dialog", { name: "開発用Brainデータ" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Brain Item一覧" })).toBeTruthy();
    expect(screen.getByText("公園を散歩した")).toBeTruthy();
    expect(mocks.fetchDevelopmentBrainItems).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.any(AbortSignal),
    );

    fireEvent.click(screen.getByRole("button", { name: "プロフィールへ戻る" }));
    await waitFor(() => expect(window.location.pathname).toBe("/profile"));
    expect(await screen.findByRole("dialog", { name: "プロフィール" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "開発用Brainデータ" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /Brain Item一覧を開く/ }));
  });

  it("/meではGET APIが返した過去版の本文へ切り替えられる", async () => {
    window.history.replaceState({}, "", "/me");

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "最近の記録から、こんなあなたらしさが見えています",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "過去のまとめがあります" }));
    expect(
      await screen.findByRole("heading", { name: "過去の記録から見えたあなたらしさ" }),
    ).toBeTruthy();
    expect(screen.getByText("現在 2件")).toBeTruthy();
    expect(screen.getByText("現在 5件")).toBeTruthy();
  });

  it("/meから新しいまとめ版の生成を要求する", async () => {
    const current = await mocks.fetchProfileSummary();
    const idle = {
      ...current,
      generation: { status: "idle" as const, canRegenerate: true, reasons: ["brain" as const] },
    };
    const queued = {
      ...current,
      generation: { status: "queued" as const, canRegenerate: false, reasons: ["brain" as const] },
    };
    mocks.fetchProfileSummary.mockClear();
    mocks.fetchProfileSummary.mockResolvedValueOnce(idle).mockResolvedValue(queued);
    window.history.replaceState({}, "", "/me");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "最新のわたしを知る" }));

    await waitFor(() =>
      expect(mocks.requestProfileSummaryGeneration).toHaveBeenCalledWith(
        "https://api.example.com",
        expect.any(AbortSignal),
      ),
    );
    expect(await screen.findByRole("heading", { name: "新しい版を作成中" })).toBeTruthy();
  });

  it("再生成が不要になっていた場合は最新状態を再取得してボタンを閉じる", async () => {
    const current = await mocks.fetchProfileSummary();
    const stale = {
      ...current,
      generation: { status: "idle" as const, canRegenerate: true, reasons: ["brain" as const] },
    };
    const refreshed = {
      ...current,
      generation: { status: "idle" as const, canRegenerate: false, reasons: [] },
    };
    mocks.fetchProfileSummary.mockResolvedValueOnce(stale).mockResolvedValue(refreshed);
    mocks.requestProfileSummaryGeneration.mockRejectedValueOnce(
      new ProfileSummaryGenerationUnavailableError("regeneration_not_required"),
    );
    window.history.replaceState({}, "", "/me");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "最新のわたしを知る" }));

    await waitFor(() => expect(mocks.fetchProfileSummary).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole("button", { name: "最新のわたしを知る" })).toBeNull();
    expect(screen.queryByText("まとめに使える記録がまだありません。")).toBeNull();
  });

  it("/meでは保存済み版がなくてもGET APIの初回生成状態を表示する", async () => {
    mocks.fetchProfileSummary.mockResolvedValue({
      summary: null,
      versions: [],
      availableDataCounts: { diagnosis: 1, diary: 2 },
      generation: { status: "generating", canRegenerate: false, reasons: [] },
      nextAction: "chat",
    });
    window.history.replaceState({}, "", "/me");

    render(<App />);

    expect(await screen.findByRole("status", { name: "新しい版を作成中" })).toBeTruthy();
    expect(screen.queryByText("まだ、わたしのまとめはありません")).toBeNull();
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
    expect(mocks.fetchProfileSummary).toHaveBeenCalledTimes(1);
    expect(mocks.fetchDevelopmentBrainItems).not.toHaveBeenCalled();
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

  it("無効な回答結果URLでは案内を表示して元のまとめへ戻せる", async () => {
    window.history.replaceState({}, "", "/diagnosis/missing/answers?from=me");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "この回答結果を開けません" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "わたしのまとめへ" }).getAttribute("href")).toBe("/me");
    expect(mocks.fetchDiagnosisResult).not.toHaveBeenCalled();
  });

  it("回答結果URLの通信失敗を同じ診断で再試行する", async () => {
    mocks.fetchDiagnosisList.mockResolvedValue([
      diagnosis({ responseStatus: "answered", answeredCount: 10 }),
    ]);
    mocks.fetchDiagnosisResult.mockRejectedValueOnce(new Error("temporary failure"));
    window.history.replaceState({}, "", "/diagnosis/diagnosis-1/answers?from=me");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "診断を読み込めませんでした" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));

    expect(await screen.findByText("結果UI: テスト診断 (1件)")).toBeTruthy();
    expect(mocks.fetchDiagnosisResult).toHaveBeenCalledTimes(2);
  });

  it("回答結果URLの初回取得中は一覧ではなく結果画面のSkeletonを表示する", () => {
    mocks.fetchDiagnosisList.mockReturnValueOnce(new Promise(() => undefined));
    window.history.replaceState({}, "", "/diagnosis/diagnosis-1/answers");

    render(<App />);

    expect(screen.getByRole("status", { name: "診断結果を読み込み中" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "診断一覧を読み込み中" })).toBeNull();
  });

  it("/compatibilityでは相性一覧を表示し、診断一覧は取得しない", async () => {
    window.history.replaceState({}, "", "/compatibility");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "ふたりの見取り図" }, { timeout: 5_000 }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性" }).getAttribute("aria-current")).toBe("page");
    expect(mocks.fetchDiagnosisList).not.toHaveBeenCalled();
  });

  it("/compatibility/shareではパートナー向け共有可否APIの結果から共有の範囲を表示する", async () => {
    window.history.replaceState({}, "", "/compatibility/share");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "うつしをシェア" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "共有されるもの" })).toBeTruthy();
    expect(screen.queryByText(/傾向があります/)).toBeNull();
    await waitFor(() =>
      expect(mocks.fetchCompatibilityShareConsent).toHaveBeenCalledWith(
        "https://api.example.com",
        "partner",
        expect.anything(),
      ),
    );
    expect(mocks.fetchDiagnosisList).not.toHaveBeenCalled();
  });

  it("相性内のリンクからカテゴリを保ってわたしへ移動し、プロフィールを再取得しない", async () => {
    window.history.replaceState({}, "", "/compatibility");
    mocks.fetchAccountProfile.mockResolvedValue({
      role: "user",
      displayName: "テスト",
      avatar: {
        source: "uploaded",
        url: "data:image/png;base64,c2F2ZWQ=",
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    });

    render(<App />);

    const profileButton = await screen.findByRole("button", { name: "プロフィールを開く" });
    await waitFor(() => expect(mocks.fetchAccountProfile).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("link", { name: "うつしをシェア" }));

    expect(await screen.findByRole("heading", { name: "うつしをシェア" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "「わたし」" }));

    await waitFor(() =>
      expect(window.location.pathname + window.location.search).toBe("/me?shareCategory=partner"),
    );
    expect(await screen.findByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
    expect(profileButton.isConnected).toBe(true);
    expect(profileButton.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,c2F2ZWQ=",
    );
    expect(mocks.fetchAccountProfile).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCompatibilityShareContent).toHaveBeenCalledWith(
      "https://api.example.com",
      "partner",
      expect.any(AbortSignal),
    );
  });

  it("LIFFの招待リンクから相性の確認画面を直接表示する", async () => {
    const relationshipId = "1".repeat(64);
    window.history.replaceState(
      {},
      "",
      `/?liff.state=${encodeURIComponent(`/compatibility/invitations/${relationshipId}`)}`,
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "2人の相性を見てみませんか？" }),
    ).toBeTruthy();
    expect(screen.getByText("あおいさんから招待が届いています")).toBeTruthy();
    expect(mocks.fetchCompatibilityInvitation).toHaveBeenCalledWith(
      "https://api.example.com",
      relationshipId,
      expect.anything(),
    );
    expect(mocks.fetchDiagnosisList).not.toHaveBeenCalled();
  });

  it("招待表示中のセッション切替で前アカウントの参加者を破棄して再判定する", async () => {
    const relationshipId = "2".repeat(64);
    window.history.replaceState({}, "", `/compatibility/invitations/${relationshipId}`);
    mocks.fetchCompatibilityInvitation
      .mockResolvedValueOnce({
        relationshipCategory: "friend",
        inviter: { displayName: "切替前の招待者", avatarUrl: null },
        recipient: { displayName: "切替前", avatarUrl: null },
        expiresAt: "2026-08-26T00:00:00.000Z",
        canAccept: true,
        blockingReasons: [],
        nextAction: null,
      })
      .mockResolvedValueOnce({
        relationshipCategory: "friend",
        inviter: { displayName: "切替後の招待者", avatarUrl: null },
        recipient: { displayName: "切替後", avatarUrl: null },
        expiresAt: "2026-08-26T00:00:00.000Z",
        canAccept: false,
        blockingReasons: [],
        nextAction: null,
      });
    const view = render(<App />);

    expect(await screen.findByText("切替前の招待者さんから招待が届いています")).toBeTruthy();

    mocks.authState = {
      status: "authenticated",
      profile: { displayName: "切替後", pictureUrl: undefined },
      role: "user",
      revision: 2,
    };
    view.rerender(<App />);

    expect(await screen.findByText("切替後の招待者さんから招待が届いています")).toBeTruthy();
    expect(screen.queryByText("切替前の招待者さんから招待が届いています")).toBeNull();
    expect(mocks.fetchCompatibilityInvitation).toHaveBeenCalledTimes(2);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it("受付中かつ未回答なら導入を経て回答画面へ進む", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(await screen.findByRole("heading", { name: "テスト診断" })).toBeTruthy();
    expect(screen.getByText(/普段の自分を思い浮かべて/)).toBeTruthy();
    expect(screen.queryByText("回答UI: テスト診断")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "診断をはじめる" }));
    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();
    expect(screen.getByText(/回答は1問ずつ保存されます/)).toBeTruthy();
    expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledWith(
      "https://api.example.com",
      "diagnosis-1",
      expect.any(AbortSignal),
    );
  });

  it("LIFFの対象診断リンクから一覧を経由せず診断入口を開く", async () => {
    window.history.replaceState(
      {},
      "",
      `/?liff.state=${encodeURIComponent("/diagnosis/diagnosis-1")}`,
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "テスト診断" })).toBeTruthy();
    expect(screen.getByText(/普段の自分を思い浮かべて/)).toBeTruthy();
    expect(mocks.fetchDiagnosisDefinition).toHaveBeenCalledWith(
      "https://api.example.com",
      "diagnosis-1",
      expect.any(AbortSignal),
    );
  });

  it("診断詳細を端末の戻る・進むで開閉し、一覧の状態と位置を復元する", async () => {
    window.history.replaceState({}, "", "/diagnosis?category=partner");
    mocks.fetchDiagnosisList.mockResolvedValue([
      diagnosis({
        id: "closed-partner",
        title: "受付終了の診断",
        relationshipCategory: "partner",
        availability: "closed",
      }),
      diagnosis({
        id: "answered-partner",
        title: "回答済みの診断",
        relationshipCategory: "partner",
        responseStatus: "answered",
        answeredCount: 10,
        lastAnsweredAt: "2026-08-06T00:00:00.000Z",
      }),
    ]);
    let scrollY = 420;
    const scrollYSpy = vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    const scrollToSpy = vi.mocked(window.scrollTo).mockImplementation((_x, y) => {
      scrollY = y ?? scrollY;
    });
    render(<App />);

    const partnerFilter = await screen.findByRole("button", { name: "パートナー" });
    expect(partnerFilter.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^回答済み 1件$/ }));
    expect(
      screen.getByRole("button", { name: /^回答済み 1件$/ }).getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /受付終了の診断/ }));
    expect(screen.getByRole("heading", { name: "この診断は受付を終了しました" })).toBeTruthy();
    expect(diagnosisDetailIdFromHistoryState(window.history.state)).toBe("closed-partner");

    act(() => window.history.back());

    expect(await screen.findByRole("heading", { name: "わたしの診断" })).toBeTruthy();
    expect(diagnosisDetailIdFromHistoryState(window.history.state)).toBeNull();
    expect(screen.getByRole("button", { name: "パートナー" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: /^回答済み 1件$/ }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: /回答済みの診断/ })).toBeTruthy();
    await waitFor(() => expect(scrollToSpy).toHaveBeenLastCalledWith(0, 420));

    act(() => window.history.forward());

    expect(
      await screen.findByRole("heading", { name: "この診断は受付を終了しました" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "診断一覧へ" }));
    expect(await screen.findByRole("heading", { name: "わたしの診断" })).toBeTruthy();
    await waitFor(() => expect(diagnosisDetailIdFromHistoryState(window.history.state)).toBeNull());
    expect(screen.getByRole("button", { name: "パートナー" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    scrollYSpy.mockRestore();
  });

  it("回答取得が即時完了しても回答画面のSkeletonを400ms表示する", async () => {
    render(<App />);
    const openDiagnosis = await screen.findByRole("button", { name: /テスト診断/ });
    vi.useFakeTimers();

    fireEvent.click(openDiagnosis);
    expect(screen.getByRole("status", { name: "診断回答を読み込み中" })).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(399);
    });

    expect(screen.getByRole("status", { name: "診断回答を読み込み中" })).toBeTruthy();
    expect(screen.queryByText("回答UI: テスト診断")).toBeNull();

    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByRole("heading", { name: "テスト診断" })).toBeTruthy();
    expect(screen.queryByText("回答UI: テスト診断")).toBeNull();
  });

  it("dev環境ではプロフィール最下部から本人データを全削除する", async () => {
    mocks.authState.role = "admin";
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "プロフィールを開く" }));
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "削除対象と取り消せないことを確認しました",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "自分のデータを全削除" }));

    await waitFor(() =>
      expect(mocks.resetDevelopmentAccountData).toHaveBeenCalledWith(
        "https://api.example.com",
        expect.any(AbortSignal),
      ),
    );
    expect(
      await screen.findByText(
        "本人データを削除しました（18件）。Vector 4件の削除を受け付けました。",
      ),
    ).toBeTruthy();
    expect(mocks.fetchDiagnosisList).toHaveBeenCalledTimes(2);
  });

  it("dev環境の本人データ削除は確認前に実行できない", async () => {
    mocks.authState.role = "admin";
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "プロフィールを開く" }));
    const deleteButton = await screen.findByRole("button", { name: "自分のデータを全削除" });

    expect(deleteButton.hasAttribute("disabled")).toBe(true);
    expect(mocks.resetDevelopmentAccountData).not.toHaveBeenCalled();
  });

  it("production環境では開発用データ操作を表示しない", async () => {
    mocks.config.environment = "production";
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "プロフィールを開く" }));
    expect(screen.queryByRole("button", { name: "自分のデータを全削除" })).toBeNull();
  });

  it("環境変数未設定では開発用データ操作を表示しない", async () => {
    mocks.config.environment = undefined;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "プロフィールを開く" }));
    expect(screen.queryByRole("button", { name: "自分のデータを全削除" })).toBeNull();
  });

  it("回答UIの選択を保存APIへ接続する", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));
    fireEvent.click(await screen.findByRole("button", { name: "テスト回答" }));
    await waitFor(() =>
      expect(mocks.saveDiagnosisAnswer).toHaveBeenCalledWith(
        "https://api.example.com",
        "diagnosis-1",
        "dq-1",
        "yes",
        { keepalive: true },
      ),
    );
  });

  it("全回答の保存完了後は保存済み回答を取得して結果画面へ進む", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));

    fireEvent.click(await screen.findByRole("button", { name: "テスト完了" }));

    expect(await screen.findByText("結果UI: テスト診断 (1件)")).toBeTruthy();
    expect(mocks.fetchDiagnosisResult).toHaveBeenCalledWith(
      "https://api.example.com",
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
      "diagnosis-1",
      expect.any(AbortSignal),
    );
    expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledWith(
      "https://api.example.com",
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

  it("アプリ内の戻るはバックグラウンド保存を待ってから一覧へ遷移する", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    mocks.saveDiagnosisAnswer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));
    await screen.findByText("回答UI: テスト診断");
    expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "テスト回答" }));
    fireEvent.click(screen.getByRole("button", { name: "テスト一覧へ戻る" }));
    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();
    expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave?.({
        outcome: "created",
        answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
        progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    await waitFor(() => expect(mocks.fetchDiagnosisProgress).toHaveBeenCalledTimes(2));
  });

  it("ブラウザ履歴の戻るもバックグラウンド保存を待ってから一覧へ遷移する", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    mocks.saveDiagnosisAnswer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));
    fireEvent.click(await screen.findByRole("button", { name: "テスト回答" }));

    act(() => window.history.back());
    await waitFor(() => expect(diagnosisDetailIdFromHistoryState(window.history.state)).toBeNull());
    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();

    await act(async () => {
      resolveSave?.({
        outcome: "created",
        answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
        progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
      });
    });
    expect(await screen.findByRole("heading", { name: "わたしの診断" })).toBeTruthy();
  });

  it("診断の直接URLから戻る場合も保存完了まで親ルートを切り替えない", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    mocks.saveDiagnosisAnswer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    window.history.replaceState({}, "", "/me");
    window.history.pushState({}, "", "/diagnosis/diagnosis-1");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));
    fireEvent.click(screen.getByRole("button", { name: "テスト回答" }));
    act(() => window.history.back());

    await waitFor(() => expect(window.location.pathname).toBe("/me"));
    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "わたしのまとめ" })).toBeNull();

    await act(async () => {
      resolveSave?.({
        outcome: "created",
        answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
        progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
      });
    });
    expect(await screen.findByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
  });

  it("保存中に履歴を連続して戻っても、最新の移動先への遷移を保存後まで待つ", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    mocks.saveDiagnosisAnswer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    window.history.replaceState({}, "", "/me");
    window.history.pushState({}, "", "/diagnosis");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));
    fireEvent.click(screen.getByRole("button", { name: "テスト回答" }));

    act(() => window.history.back());
    await waitFor(() => expect(diagnosisDetailIdFromHistoryState(window.history.state)).toBeNull());
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/me"));
    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();

    await act(async () => {
      resolveSave?.({
        outcome: "created",
        answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
        progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
      });
    });
    expect(await screen.findByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
  });

  it("保存中に戻ってから進んだ場合は、保存後も最新の詳細履歴を表示する", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    mocks.saveDiagnosisAnswer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));
    fireEvent.click(screen.getByRole("button", { name: "テスト回答" }));

    act(() => window.history.back());
    await waitFor(() => expect(diagnosisDetailIdFromHistoryState(window.history.state)).toBeNull());
    act(() => window.history.forward());
    await waitFor(() =>
      expect(diagnosisDetailIdFromHistoryState(window.history.state)).toBe("diagnosis-1"),
    );
    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();

    await act(async () => {
      resolveSave?.({
        outcome: "created",
        answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
        progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
      });
    });
    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "わたしの診断" })).toBeNull();
  });

  it("直接URLからの戻る中に保存が失敗した場合は診断URLを復元する", async () => {
    let rejectSave: ((reason?: unknown) => void) | undefined;
    mocks.saveDiagnosisAnswer.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    window.history.replaceState({}, "", "/me");
    window.history.pushState({}, "", "/diagnosis/diagnosis-1");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));
    fireEvent.click(screen.getByRole("button", { name: "テスト回答" }));
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/me"));

    await act(async () => rejectSave?.(new Error("通信に失敗しました")));

    await waitFor(() => expect(window.location.pathname).toBe("/diagnosis/diagnosis-1"));
    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "わたしのまとめ" })).toBeNull();
  });

  it("保存中の再読込・tab終了・外部遷移を標準離脱警告で確認する", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    mocks.saveDiagnosisAnswer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));
    fireEvent.click(await screen.findByRole("button", { name: "テスト回答" }));

    await waitFor(() => {
      const event = new Event("beforeunload", { cancelable: true });
      expect(window.dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    });

    await act(async () => {
      resolveSave?.({
        outcome: "created",
        answer: { acceptedAt: "2026-08-05T00:00:01.000Z" },
        progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
      });
    });
    await waitFor(() => {
      const event = new Event("beforeunload", { cancelable: true });
      expect(window.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  it("回答保存に失敗した場合は戻らず、同じ回答の再試行経路を残す", async () => {
    mocks.saveDiagnosisAnswer.mockRejectedValue(new Error("通信に失敗しました"));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));
    fireEvent.click(await screen.findByRole("button", { name: "診断をはじめる" }));
    fireEvent.click(await screen.findByRole("button", { name: "テスト回答" }));
    await waitFor(() => expect(mocks.saveDiagnosisAnswer).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "テスト一覧へ戻る" }));

    expect(screen.getByText("回答UI: テスト診断")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /テスト診断/ })).toBeNull();
  });

  it("受付終了した回答途中診断は再開せず保存済み回答だけを表示する", async () => {
    mocks.fetchDiagnosisList.mockResolvedValue([
      diagnosis({ availability: "closed", responseStatus: "in-progress", answeredCount: 1 }),
    ]);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /テスト診断/ }));

    expect(await screen.findByText("結果UI: テスト診断 (1件)")).toBeTruthy();
    expect(mocks.fetchDiagnosisDefinition).not.toHaveBeenCalled();
    expect(mocks.fetchDiagnosisProgress).not.toHaveBeenCalled();
    expect(mocks.fetchDiagnosisResult).toHaveBeenCalledOnce();
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

    expect(await screen.findByRole("heading", { name: "API追加診断" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "診断をはじめる" }));
    expect(screen.getByText("回答UI: API追加診断")).toBeTruthy();
    expect(mocks.fetchDiagnosisDefinition).toHaveBeenCalledWith(
      "https://api.example.com",
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

  it("一覧取得失敗後の再試行ではアプリセッションを維持する", async () => {
    mocks.fetchDiagnosisList
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([diagnosis()]);
    render(<App />);

    const retry = await screen.findByRole("button", { name: "再試行" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(await screen.findByRole("button", { name: /テスト診断/ })).toBeTruthy();
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
    expect(mocks.fetchDiagnosisList).toHaveBeenCalledTimes(1);
  });

  it("アンマウント時に進行中の一覧リクエストを中断する", async () => {
    let signal: AbortSignal | undefined;
    mocks.fetchDiagnosisList.mockImplementation((_apiUrl: string, receivedSignal: AbortSignal) => {
      signal = receivedSignal;
      return new Promise<DiagnosisListItem[]>(() => undefined);
    });
    const view = render(<App />);
    await waitFor(() => expect(mocks.fetchDiagnosisList).toHaveBeenCalledTimes(1));

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });
});
