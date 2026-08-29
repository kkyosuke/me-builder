// @vitest-environment jsdom

import { currentServiceTerms } from "@me-builder/shared";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { authSessionRuntime } from "../infrastructure/auth-session-runtime";

// App全体のlazy routeとAPI往復を、E2E並列実行時の負荷でも待ち切る。
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

const relationshipId = "1".repeat(64);
const authenticatedSession = {
  authenticated: true,
  displayProfile: { displayName: "受信者" },
  role: "user",
  csrfToken: "csrf-session-token",
};
const acceptedTerms = {
  document: currentServiceTerms,
  notice: null,
  acceptance: {
    required: false,
    acceptedVersion: currentServiceTerms.version,
    documentHash: currentServiceTerms.contentHash,
    acceptedAt: "2026-08-16T00:00:00.000Z",
  },
};
const invitation = {
  relationshipCategory: "friend",
  inviter: { displayName: "招待者", avatarUrl: null },
  recipient: { displayName: "受信者", avatarUrl: null },
  expiresAt: "2026-08-18T00:00:00.000Z",
  canAccept: true,
  blockingReasons: [],
  nextAction: null,
};
const freeEntitlement = {
  status: "free",
  plan: "free",
  source: "free",
  effectiveAt: "2026-08-16T00:00:00.000Z",
  availableUntil: null,
  aiReply: {
    limit: 0,
    used: 0,
    reserved: 0,
    remaining: 0,
    periodStartsAt: "2026-08-01T00:00:00.000Z",
    resetsAt: "2026-09-01T00:00:00.000Z",
  },
};

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), "https://web.example.com");
}

describe("application session Web E2E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authSessionRuntime.reset();
    liff.initialize.mockResolvedValue({
      status: "ready",
      inClient: true,
    });
    liff.readCredential.mockReturnValue("secret.liff.credential");
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("LIFF credentialを一度だけ交換し、復元した招待をCookieとCSRFで承諾する", async () => {
    let sessionChecks = 0;
    let exchangeRequests = 0;
    let acceptanceRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/auth/session") {
        sessionChecks += 1;
        return Response.json({ authenticated: false, reason: "session-expired" });
      }
      if (url.pathname === "/api/auth/liff/exchange") {
        exchangeRequests += 1;
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({ idToken: "secret.liff.credential" });
        expect(String(input)).not.toContain("secret.liff.credential");
        return Response.json(authenticatedSession);
      }
      if (url.pathname === "/api/legal/terms") return Response.json(acceptedTerms);
      if (url.pathname === "/api/profile") {
        return Response.json({ role: "user", displayName: "受信者", avatar: null });
      }
      if (url.pathname === "/api/profile/entitlement") return Response.json(freeEntitlement);
      if (url.pathname === `/api/compatibility/invitations/${relationshipId}`) {
        const headers = new Headers(init?.headers);
        expect(init?.credentials).toBe("include");
        expect(headers.get("Authorization")).toBeNull();
        return Response.json(invitation);
      }
      if (
        url.pathname === `/api/compatibility/invitations/${relationshipId}/accept` &&
        method === "POST"
      ) {
        acceptanceRequests += 1;
        const headers = new Headers(init?.headers);
        expect(init?.credentials).toBe("include");
        expect(headers.get("X-CSRF-Token")).toBe("csrf-session-token");
        expect(headers.get("Authorization")).toBeNull();
        return Response.json({ relationshipId, status: "accepted" });
      }
      throw new Error(`Unexpected E2E request: ${method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(
      {},
      "",
      `/?liff.state=${encodeURIComponent(`/compatibility/invitations/${relationshipId}`)}`,
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "2人の相性を見てみませんか？" }),
    ).toBeTruthy();
    expect(screen.getByText("招待者さんから招待が届いています")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "相性を見てみる" }));
    expect(
      await screen.findByRole("heading", { name: "2人の相性シートを作りました" }),
    ).toBeTruthy();

    // LIFF内では別AccountのSSO cookieを採用しないため、既存sessionを確認せず交換する。
    expect(sessionChecks).toBe(0);
    expect(exchangeRequests).toBe(1);
    expect(acceptanceRequests).toBe(1);
    expect(liff.initialize).toHaveBeenCalledTimes(1);
    expect(liff.readCredential).toHaveBeenCalledTimes(1);
  });

  it("feature APIの401でsessionを再確認し、再認証できなければ旧画面を隠す", async () => {
    let sessionChecks = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.pathname === "/api/auth/session") {
        sessionChecks += 1;
        return sessionChecks === 1
          ? Response.json(authenticatedSession)
          : new Response(null, { status: 401 });
      }
      if (url.pathname === "/api/legal/terms") return Response.json(acceptedTerms);
      if (url.pathname === "/api/profile") {
        return Response.json({ role: "user", displayName: "受信者", avatar: null });
      }
      if (url.pathname === "/api/profile/entitlement") return Response.json(freeEntitlement);
      if (url.pathname === `/api/compatibility/invitations/${relationshipId}`) {
        expect(new Headers(init?.headers).get("Authorization")).toBeNull();
        return new Response(null, { status: 401 });
      }
      throw new Error(`Unexpected E2E request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    liff.initialize.mockResolvedValue({
      status: "disabled",
      reason: "VITE_LIFF_ID が未設定です",
    });
    window.history.replaceState({}, "", `/compatibility/invitations/${relationshipId}`);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "本人確認が必要です" })).toBeTruthy();
    expect(screen.queryByText("招待者さんから招待が届いています")).toBeNull();
    await waitFor(() => expect(sessionChecks).toBe(2));
    expect(liff.readCredential).not.toHaveBeenCalled();
  });

  it("sessionが別Accountへ切り替わったら前Accountの規約同意を破棄する", async () => {
    let sessionChecks = 0;
    let termsChecks = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname === "/api/auth/session") {
        sessionChecks += 1;
        return Response.json({
          ...authenticatedSession,
          displayProfile: { displayName: sessionChecks === 1 ? "Account A" : "Account B" },
        });
      }
      if (url.pathname === "/api/legal/terms") {
        termsChecks += 1;
        return Response.json(
          termsChecks === 1
            ? acceptedTerms
            : {
                document: currentServiceTerms,
                notice: null,
                acceptance: {
                  required: true,
                  acceptedVersion: null,
                  documentHash: null,
                  acceptedAt: null,
                },
              },
        );
      }
      if (url.pathname === "/api/profile") {
        return Response.json({ role: "user", displayName: "Account A", avatar: null });
      }
      if (url.pathname === "/api/profile/entitlement") return Response.json(freeEntitlement);
      if (url.pathname === `/api/compatibility/invitations/${relationshipId}`) {
        return new Response(null, { status: 401 });
      }
      throw new Error(`Unexpected E2E request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    liff.initialize.mockResolvedValue({
      status: "disabled",
      reason: "外部ブラウザからのアクセスです",
    });
    window.history.replaceState({}, "", `/compatibility/invitations/${relationshipId}`);

    render(<App />);

    expect(await screen.findByRole("heading", { name: currentServiceTerms.title })).toBeTruthy();
    expect(screen.queryByText("招待者さんから招待が届いています")).toBeNull();
    expect(sessionChecks).toBe(2);
    expect(termsChecks).toBe(2);
  });
});
