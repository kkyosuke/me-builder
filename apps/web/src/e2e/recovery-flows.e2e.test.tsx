// @vitest-environment jsdom

import { currentServiceTerms } from "@me-builder/shared";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

// App全体の初期描画とAPI往復を待つため、他のE2Eと同時実行しても既定の1秒で切らない。
configure({ asyncUtilTimeout: 10_000 });

const liff = vi.hoisted(() => ({
  initialize: vi.fn(),
  readCredential: vi.fn(),
}));

vi.mock("../config", () => ({
  config: {
    environment: "production",
    liffId: "test-liff-id",
    apiUrl: "https://api.example.com",
  },
}));
vi.mock("../feature/liff/infrastructure/liff-client", () => ({
  initializeLiffForAuthExchange: liff.initialize,
  readLiffAuthExchangeCredential: liff.readCredential,
}));

const accountProfile = { role: "user", avatar: null };
const authSession = {
  authenticated: true,
  displayProfile: { displayName: "テスト" },
  role: "user",
  csrfToken: "csrf-test-token",
};
const progression = {
  level: 2,
  growthValue: 7,
  currentLevelThreshold: 5,
  nextLevelThreshold: 20,
  collectedPieces: 2,
  activePieces: 2,
  categoryCount: 2,
  calculationVersion: 1,
  highestLevel: 2,
  isProcessing: false,
  recentChanges: [],
  milestoneCards: [],
};
const acceptedTermsStatus = {
  document: currentServiceTerms,
  acceptance: {
    required: false,
    acceptedVersion: currentServiceTerms.version,
    documentHash: currentServiceTerms.contentHash,
    acceptedAt: "2026-08-15T01:23:45.000Z",
  },
};
const diagnosisList = {
  diagnoses: [
    {
      id: "diagnosis-1",
      title: "テスト診断",
      description: "回答結果の再試行を確認する診断",
      relationshipCategory: "general",
      opensAt: "2026-08-01T00:00:00.000Z",
      closesAt: null,
      displayOrder: 1,
      availability: "open",
      responseStatus: "answered",
      answeredCount: 1,
      questionCount: 1,
      lastAnsweredAt: "2026-08-10T00:00:00.000Z",
    },
  ],
};
const diagnosisResult = {
  id: "diagnosis-1",
  title: "テスト診断",
  description: "回答結果の再試行を確認する診断",
  relationshipCategory: "general",
  responseStatus: "answered",
  answeredCount: 1,
  questionCount: 1,
  answers: [
    {
      diagnosisQuestionId: "dq-1",
      questionId: "q-1",
      questionVersion: 1,
      questionText: "予定を早めに決めたいですか？",
      choiceId: "yes",
      choiceLabel: "はい",
      acceptedAt: "2026-08-10T00:00:00.000Z",
    },
  ],
  scoring: null,
};

function summaryResponse({
  id,
  headline,
  status,
  canRegenerate,
}: {
  id: string;
  headline: string;
  status: "idle" | "queued";
  canRegenerate: boolean;
}) {
  const summary = {
    generatedAt: "2026-08-10T00:00:00.000Z",
    headline,
    insights: [
      {
        key: "planning",
        label: "見通しを持つ",
        description: "予定を把握すると落ち着いて動きやすい傾向があります。",
        evidenceCount: 1,
        sources: ["diary"],
      },
    ],
    recordCount: 1,
    diagnosisCount: 0,
    diaryCount: 1,
    latestRecordedAt: "2026-08-09T00:00:00.000Z",
  };
  return {
    versions: [
      {
        id,
        sequence: id === "version-2" ? 2 : 1,
        generatedAt: summary.generatedAt,
        isLatest: true,
        generationMethod: "ai",
        summary,
      },
    ],
    availableDataCounts: { diagnosis: 0, diary: 2 },
    generation: {
      status,
      canRegenerate,
      reasons: canRegenerate ? ["brain"] : [],
      message: null,
    },
    diagnosisThemes: [],
    nextAction: "chat",
  };
}

function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
}

describe("Web recovery flows E2E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    liff.initialize.mockResolvedValue({
      status: "ready",
      inClient: true,
    });
    liff.readCredential.mockReturnValue("dummy.id.token");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("診断結果の直リンク取得が一時失敗しても、同じURLから再試行して表示する", async () => {
    let resultRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.pathname === "/api/auth/liff/exchange") return Response.json(authSession);
      if (url.pathname === "/api/auth/session") return Response.json(authSession);
      if (url.pathname === "/api/legal/terms") return Response.json(acceptedTermsStatus);
      if (url.pathname === "/api/profile") return Response.json(accountProfile);
      if (url.pathname === "/api/diagnoses") return Response.json(diagnosisList);
      if (url.pathname === "/api/diagnoses/diagnosis-1/answers") {
        resultRequests += 1;
        return resultRequests === 1
          ? Response.json({ error: "temporary failure" }, { status: 503 })
          : Response.json(diagnosisResult);
      }
      throw new Error(`Unexpected E2E request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/diagnosis/diagnosis-1/answers?from=me");

    render(<App />);

    expect(await screen.findByRole("status", { name: "診断結果を読み込み中" })).toBeTruthy();
    expect(
      await screen.findByRole(
        "heading",
        { name: "診断を読み込めませんでした" },
        { timeout: 2_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));

    expect(await screen.findByRole("heading", { name: "テスト診断" })).toBeTruthy();
    expect(screen.getByText("1 / 1問に回答")).toBeTruthy();
    expect(resultRequests).toBe(2);
    expect(window.location.pathname).toBe("/diagnosis/diagnosis-1/answers");
  });

  it("まとめ生成POSTの応答が失われても、受付済みGETから完了版まで追跡する", async () => {
    const initial = summaryResponse({
      id: "version-1",
      headline: "生成前のまとめ",
      status: "idle",
      canRegenerate: true,
    });
    const queued = summaryResponse({
      id: "version-1",
      headline: "生成前のまとめ",
      status: "queued",
      canRegenerate: false,
    });
    const completed = summaryResponse({
      id: "version-2",
      headline: "応答消失後に完成したまとめ",
      status: "idle",
      canRegenerate: false,
    });
    let summaryReads = 0;
    let generationPosts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/auth/liff/exchange") return Response.json(authSession);
      if (url.pathname === "/api/auth/session") return Response.json(authSession);
      if (url.pathname === "/api/legal/terms") return Response.json(acceptedTermsStatus);
      if (url.pathname === "/api/profile") return Response.json(accountProfile);
      if (url.pathname === "/api/profile/progression") return Response.json(progression);
      if (url.pathname === "/api/profile-summary" && method === "GET") {
        summaryReads += 1;
        return Response.json(
          summaryReads === 1 ? initial : summaryReads === 2 ? queued : completed,
        );
      }
      if (url.pathname === "/api/profile-summary/generations" && method === "POST") {
        generationPosts += 1;
        throw new TypeError("connection closed after the server accepted the request");
      }
      throw new Error(`Unexpected E2E request: ${method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/me");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "生成前のまとめ" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "最新のわたしを知る" }));

    expect(await screen.findByRole("heading", { name: "応答消失後に完成したまとめ" })).toBeTruthy();
    await waitFor(() => expect(summaryReads).toBe(3));
    expect(generationPosts).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("本人の進行度APIを読み、診断の有無に依存せずうつしレベルを表示する", async () => {
    const summary = summaryResponse({
      id: "version-1",
      headline: "進行度と一緒に表示するまとめ",
      status: "idle",
      canRegenerate: false,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.pathname === "/api/auth/liff/exchange") return Response.json(authSession);
      if (url.pathname === "/api/auth/session") return Response.json(authSession);
      if (url.pathname === "/api/legal/terms") return Response.json(acceptedTermsStatus);
      if (url.pathname === "/api/profile") return Response.json(accountProfile);
      if (url.pathname === "/api/profile-summary") return Response.json(summary);
      if (url.pathname === "/api/profile/progression") return Response.json(progression);
      throw new Error(`Unexpected E2E request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/me");

    render(<App />);

    expect(await screen.findByText("Lv.2")).toBeTruthy();
    expect(screen.getByText("わたしのかけら")).toBeTruthy();
    expect(screen.getByText("分類の広がり")).toBeTruthy();
    expect(screen.queryByText("UIプレビュー用のサンプルデータです")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/profile/progression",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("診断画面のうつしレベルを固定プロフィールアイコンと重ならない位置に表示する", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.pathname === "/api/auth/session") return Response.json(authSession);
      if (url.pathname === "/api/legal/terms") return Response.json(acceptedTermsStatus);
      if (url.pathname === "/api/profile") return Response.json(accountProfile);
      if (url.pathname === "/api/diagnoses") return Response.json(diagnosisList);
      if (url.pathname === "/api/profile/progression") return Response.json(progression);
      throw new Error(`Unexpected E2E request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const level = await screen.findByRole("link", {
      name: "うつしレベル2、わたしのまとめを見る",
    });
    const profileButton = await screen.findByRole("button", { name: "プロフィールを開く" });
    expect(level.parentElement?.className).toContain("pr-14");
    expect(profileButton.className).toContain("fixed");
  }, 10_000);
});
