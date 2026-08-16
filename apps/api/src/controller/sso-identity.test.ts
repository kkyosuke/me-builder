import { logger } from "@me-builder/shared";
import { type Handler, Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";

const mocks = vi.hoisted(() => {
  class CannotUnlinkLastIdentityError extends Error {}
  return {
    CannotUnlinkLastIdentityError,
    createClient: vi.fn(() => ({ client: true })),
    createStore: vi.fn(() => ({ store: true })),
    createLinker: vi.fn(() => ({ linker: true })),
    createResolver: vi.fn(() => ({ resolver: true })),
    getStatus: vi.fn(),
    unlink: vi.fn(),
    invalidateSessions: vi.fn(),
    logoutSession: vi.fn(),
    issueSession: vi.fn(),
    startLinking: vi.fn(),
    startLogin: vi.fn(),
    completeCallback: vi.fn(),
    cancelAuthentication: vi.fn(),
  };
});

vi.mock("@me-builder/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@me-builder/lib")>();
  return {
    ...actual,
    D1: {
      shared: {
        ...actual.D1.shared,
        client: { create: vi.fn(() => ({ db: true })) },
        action: {
          ...actual.D1.shared.action,
          account: {
            ...actual.D1.shared.action.account,
            CannotUnlinkLastIdentityError: mocks.CannotUnlinkLastIdentityError,
          },
        },
      },
    },
  };
});
vi.mock("../infrastructure/authentication/sso-client", () => ({
  createAuth0SsoClient: mocks.createClient,
}));
vi.mock("../infrastructure/authentication/application-session-runtime", () => ({
  APPLICATION_SESSION_COOKIE: "__Host-me_builder_session",
  createApplicationSessionService: vi.fn(() => ({
    db: { db: true },
    sessions: {
      invalidateAccountSessions: mocks.invalidateSessions,
      issue: mocks.issueSession,
      logout: mocks.logoutSession,
    },
  })),
}));
vi.mock("../infrastructure/authentication/sso-transaction-store", () => ({
  createSsoTransactionStore: mocks.createStore,
}));
vi.mock("../infrastructure/authentication/sso-identity-repository", () => ({
  createSsoExistingIdentityResolver: mocks.createResolver,
  createSsoIdentityLinker: mocks.createLinker,
  getSsoIdentityStatus: mocks.getStatus,
  unlinkSsoIdentity: mocks.unlink,
}));
vi.mock("../logic/authentication/sso-transaction", () => ({
  startSsoIdentityLinking: mocks.startLinking,
  startSsoAuthentication: mocks.startLogin,
  completeSsoCallback: mocks.completeCallback,
  cancelSsoAuthentication: mocks.cancelAuthentication,
}));

import {
  deleteSsoIdentity,
  getSsoCallback,
  getSsoIdentityStatusContents,
  postSsoIdentityLink,
  postSsoLogin,
} from "./sso-identity";

const env = {
  ENVIRONMENT: "preview",
  WEB_ORIGIN: "https://stg.example.com",
  BASE_URL: "https://api.stg.example.com",
  SSO_ROLLOUT_MODE: "linking",
  SSO_ISSUER_URL: "https://tenant.auth0.com/",
  SSO_CLIENT_ID: "client-id",
  SSO_CLIENT_SECRET: "client-secret",
  SESSION_STORE: {},
  DB: {},
} as AppEnv["Bindings"];

function testApp(path: string, handler: Handler<AppEnv>) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("authenticatedActor", {
      accountId: "account-at-start",
      authenticationMethod: "liff",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
    });
    await next();
  });
  app.get(path, handler);
  app.post(path, handler);
  app.delete(path, handler);
  return app;
}

describe("SSO identity controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.issueSession.mockResolvedValue({
      sessionToken: "rotated-session",
      csrfToken: "csrf-token",
      expiresAt: new Date("2026-09-16T00:00:00.000Z"),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("外部subjectを返さず本人のlink状態だけを返す", async () => {
    mocks.getStatus.mockResolvedValue({ linked: true, canUnlink: true });
    const response = await testApp("/api/auth/sso/identity", getSsoIdentityStatusContents).request(
      "https://api.example.com/api/auth/sso/identity",
      undefined,
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ linked: true, canUnlink: true });
    expect(mocks.getStatus).toHaveBeenCalledWith(expect.anything(), "account-at-start");
  });

  it("認証済みAccountと相対returnToをlink transactionへ固定して認可URLを返す", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    const log = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    mocks.startLinking.mockResolvedValue(
      new URL("https://tenant.auth0.com/authorize?state=opaque"),
    );
    const response = await testApp("/api/auth/sso/link", postSsoIdentityLink).request(
      "https://api.example.com/api/auth/sso/link?returnTo=%2Fprofile",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authorizationUrl: "https://tenant.auth0.com/authorize?state=opaque",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-me_builder_sso_callback_state=opaque",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(mocks.createStore).toHaveBeenCalledWith(env.SESSION_STORE);
    expect(mocks.startLinking).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "00000000-0000-4000-8000-000000000001",
        initiatingAccountId: "account-at-start",
        returnTo: "/profile",
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "sso.authentication.started",
        traceId: "00000000-0000-4000-8000-000000000001",
        purpose: "link",
        outcome: "succeeded",
      }),
      "[SSO] succeeded at authorization.create -> auth0-redirect",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("account-at-start");
  });

  it("link callback成功後は保存済みpathだけへ復帰する", async () => {
    const log = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    mocks.completeCallback.mockResolvedValue({
      purpose: "link",
      accountId: "account-at-start",
      authenticatedIdentityId: "identity-auth0",
      authenticationMethod: "sso",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      providerKey: "auth0",
      returnTo: "/profile",
      traceId: "00000000-0000-4000-8000-000000000002",
    });
    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=opaque&code=code",
      { headers: { Cookie: "__Host-me_builder_sso_callback_state=opaque" } },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://stg.example.com/profile?sso=linked");
    expect(mocks.completeCallback).toHaveBeenCalledWith(
      expect.objectContaining({ state: "opaque", code: "code" }),
    );
    expect(mocks.invalidateSessions).toHaveBeenCalledWith("account-at-start");
    expect(mocks.issueSession).toHaveBeenCalledWith(
      {
        accountId: "account-at-start",
        authenticationMethod: "sso",
        authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      },
      "identity-auth0",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-me_builder_session=rotated-session",
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "sso.callback.completed",
        traceId: "00000000-0000-4000-8000-000000000002",
        stage: "identity.link",
      }),
      "[SSO] succeeded at identity.link -> web-redirect",
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/opaque|code|auth0\|/u);
  });

  it("callback失敗を生の例外や認証parameterなしで固定分類へ記録する", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    mocks.completeCallback.mockRejectedValue(new Error("secret provider response"));

    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=sensitive-state&code=sensitive-code",
      { headers: { Cookie: "__Host-me_builder_sso_callback_state=sensitive-state" } },
      env,
    );

    expect(response.status).toBe(302);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "sso.callback.failed",
        errorCode: "SSO_CALLBACK_FAILED",
        errorCategory: "unknown",
        retryable: false,
      }),
      expect.stringContaining("SSO_CALLBACK_FAILED"),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/sensitive|secret provider/u);
  });

  it("linked-login公開時だけ外部ブラウザのSSOログインを開始する", async () => {
    mocks.startLogin.mockResolvedValue(new URL("https://tenant.auth0.com/authorize?state=login"));
    const response = await testApp("/api/auth/sso/login", postSsoLogin).request(
      "https://api.example.com/api/auth/sso/login?returnTo=%2Fadmin",
      { method: "POST" },
      { ...env, SSO_ROLLOUT_MODE: "linked-login" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authorizationUrl: "https://tenant.auth0.com/authorize?state=login",
    });
    expect(mocks.startLogin).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/admin" }));
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-me_builder_sso_callback_state=login",
    );
  });

  it("login callbackで共通application sessionをcookieへ設定して固定pathへ復帰する", async () => {
    mocks.completeCallback.mockResolvedValue({
      purpose: "login",
      session: {
        sessionToken: "sso-session",
        csrfToken: "csrf-token",
        expiresAt: new Date("2026-09-16T00:00:00.000Z"),
      },
      returnTo: "/admin",
    });
    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=login&code=code",
      { headers: { Cookie: "__Host-me_builder_sso_callback_state=login" } },
      { ...env, SSO_ROLLOUT_MODE: "linked-login" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://stg.example.com/admin");
    expect(mocks.completeCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "login",
        code: "code",
        identityResolver: { resolver: true },
        identityLinker: { linker: true },
        sessionIssuer: expect.objectContaining({ issue: expect.any(Function) }),
      }),
    );
    expect(response.headers.get("set-cookie")).toContain("__Host-me_builder_session=sso-session");
  });

  it.each([
    { purpose: "link", returnTo: "/profile" },
    { purpose: "login", returnTo: "/diagnosis/result" },
  ] as const)(
    "IdPで$purposeをキャンセルしてもtransactionを消費して固定pathへ復帰する",
    async ({ purpose, returnTo }) => {
      const log = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      mocks.cancelAuthentication.mockResolvedValue({ purpose, returnTo, traceId: "trace-cancel" });
      const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
        "https://api.example.com/api/auth/sso/callback?state=opaque&error=access_denied",
        { headers: { Cookie: "__Host-me_builder_sso_callback_state=opaque" } },
        env,
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `https://stg.example.com${returnTo}?sso=cancelled`,
      );
      expect(mocks.cancelAuthentication).toHaveBeenCalledWith(
        expect.objectContaining({ state: "opaque" }),
      );
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "sso.callback.cancelled",
          purpose,
          traceId: "trace-cancel",
        }),
        expect.stringContaining("SSO_AUTHORIZATION_CANCELLED"),
      );
    },
  );

  it("開始browserと一致しないlink callbackをtransaction消費前に拒否する", async () => {
    const log = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=transferred&code=code",
      { headers: { Cookie: "__Host-me_builder_sso_callback_state=another" } },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://stg.example.com/profile?sso=error");
    expect(mocks.completeCallback).not.toHaveBeenCalled();
    expect(mocks.cancelAuthentication).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "sso.callback.rejected",
        resultCode: "SSO_CALLBACK_STATE_MISMATCH",
      }),
      expect.stringContaining("SSO_CALLBACK_STATE_MISMATCH"),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("transferred");
  });

  it("最後のIdentity解除は409にして保持する", async () => {
    mocks.unlink.mockRejectedValue(new mocks.CannotUnlinkLastIdentityError());
    const response = await testApp("/api/auth/sso/identity", deleteSsoIdentity).request(
      "https://api.example.com/api/auth/sso/identity",
      { method: "DELETE" },
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Last login identity cannot be unlinked" });
    expect(mocks.invalidateSessions).not.toHaveBeenCalled();
  });

  it("Identity解除後はAccountの全sessionを失効してcookieを破棄する", async () => {
    mocks.unlink.mockResolvedValue(undefined);
    const response = await testApp("/api/auth/sso/identity", deleteSsoIdentity).request(
      "https://api.example.com/api/auth/sso/identity",
      { method: "DELETE" },
      env,
    );

    expect(response.status).toBe(204);
    expect(mocks.unlink).toHaveBeenCalledWith(expect.anything(), "account-at-start");
    expect(mocks.invalidateSessions).toHaveBeenCalledWith("account-at-start");
    expect(response.headers.get("set-cookie")).toContain("__Host-me_builder_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
