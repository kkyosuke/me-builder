// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider, useAuthSession } from "../feature/auth";
import { authSessionRuntime } from "../feature/auth/infrastructure/auth-session-runtime";

const mocks = vi.hoisted(() => ({
  config: {
    apiUrl: "https://api.example.com",
    liffId: "test-liff-id",
    ssoRolloutMode: "linked-login" as "disabled" | "linking" | "linked-login",
  },
  initializeLiffForAuthExchange: vi.fn(),
  readCredential: vi.fn(),
  redirectToLiffLogin: vi.fn(),
  establishSsoAuthSession: vi.fn(),
}));

vi.mock("../config", () => ({ config: mocks.config }));
vi.mock("../feature/liff/infrastructure/liff-client", () => ({
  initializeLiffForAuthExchange: mocks.initializeLiffForAuthExchange,
  readLiffAuthExchangeCredential: mocks.readCredential,
  redirectToLiffLogin: mocks.redirectToLiffLogin,
}));
vi.mock("../feature/auth/infrastructure/sso-auth-adapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../feature/auth/infrastructure/sso-auth-adapter")>()),
  establishSsoAuthSession: mocks.establishSsoAuthSession,
}));

function SessionState() {
  const { state } = useAuthSession();
  return (
    <div>
      <output data-testid="auth-status">{state.status}</output>
      {state.status === "authenticated" ? (
        <output data-testid="auth-profile">{state.profile.displayName}</output>
      ) : null}
    </div>
  );
}

function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
}

describe("LIFF / SSO entry routing E2E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authSessionRuntime.reset();
    mocks.config.ssoRolloutMode = "linked-login";
    mocks.readCredential.mockReturnValue("liff-id-token");
    mocks.establishSsoAuthSession.mockReturnValue({ redirecting: true });
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("LIFF内は既存SSO cookieを採用せずLIFF Identityでsessionを切り替える", async () => {
    mocks.initializeLiffForAuthExchange.mockResolvedValue({
      status: "ready",
      inClient: true,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.pathname === "/api/auth/liff/exchange" && init?.method === "POST") {
        return Response.json({
          authenticated: true,
          authenticationMethod: "liff",
          authenticatedAt: "2026-08-17T00:00:00.000Z",
          expiresAt: "2026-08-24T00:00:00.000Z",
          displayProfile: { displayName: "LIFF Account" },
          role: "user",
          csrfToken: "csrf-after-switch",
        });
      }
      throw new Error(`Unexpected E2E request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthSessionProvider>
        <SessionState />
      </AuthSessionProvider>,
    );

    expect(await screen.findByText("authenticated")).toBeTruthy();
    expect(screen.getByText("LIFF Account")).toBeTruthy();
    expect(authSessionRuntime.csrfToken()).toBe("csrf-after-switch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.establishSsoAuthSession).not.toHaveBeenCalled();
  });

  it("外部ブラウザは未認証時にLIFF loginを呼ばず要求pathのSSOを開始する", async () => {
    mocks.initializeLiffForAuthExchange.mockResolvedValue({
      status: "ready",
      inClient: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.pathname === "/api/auth/session") {
          return Response.json({ authenticated: false, reason: "session-expired" });
        }
        throw new Error(`Unexpected E2E request: ${url.pathname}`);
      }),
    );
    window.history.replaceState({}, "", "/compatibility/invitations/invite-fixture?from=share");

    render(
      <AuthSessionProvider>
        <SessionState />
      </AuthSessionProvider>,
    );

    expect(await screen.findByText("redirecting")).toBeTruthy();
    expect(mocks.establishSsoAuthSession).toHaveBeenCalledWith(
      "https://api.example.com",
      "/compatibility/invitations/invite-fixture?from=share",
      expect.any(AbortSignal),
    );
    expect(mocks.redirectToLiffLogin).not.toHaveBeenCalled();
  });

  it("SSO失敗から戻った外部ブラウザは自動再開せずmarkerだけを消して再試行を待つ", async () => {
    mocks.initializeLiffForAuthExchange.mockResolvedValue({
      status: "ready",
      inClient: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.pathname === "/api/auth/session") {
          return new Response(null, { status: 401 });
        }
        throw new Error(`Unexpected E2E request: ${url.pathname}`);
      }),
    );
    window.history.replaceState(
      {},
      "",
      "/compatibility/invitations/invite-fixture?from=share&sso=error#details",
    );

    render(
      <AuthSessionProvider>
        <SessionState />
      </AuthSessionProvider>,
    );

    expect(await screen.findByText("error")).toBeTruthy();
    expect(mocks.establishSsoAuthSession).not.toHaveBeenCalled();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/compatibility/invitations/invite-fixture?from=share#details",
    );
  });

  it("LIFF初期化失敗は外部SSOへ自動fallbackしない", async () => {
    mocks.initializeLiffForAuthExchange.mockResolvedValue({
      status: "error",
      message: "LIFF initialization failed",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthSessionProvider>
        <SessionState />
      </AuthSessionProvider>,
    );

    expect(await screen.findByText("error")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.establishSsoAuthSession).not.toHaveBeenCalled();
  });
});
