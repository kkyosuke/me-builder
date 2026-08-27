import { logger } from "@me-builder/shared";
import { type Handler, Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";

const mocks = vi.hoisted(() => {
  class CannotUnlinkLastIdentityError extends Error {}
  class IdentityAlreadyLinkedError extends Error {}
  class SsoProviderError extends Error {
    constructor(readonly reason: "configuration" | "provider_rejected" | "token_invalid") {
      super(reason);
    }
  }
  class SsoAuthenticationError extends Error {
    constructor(
      readonly reason: string,
      readonly callback?: { traceId?: string; returnTo: string },
    ) {
      super(reason);
    }
  }
  class SsoCallbackCompletionError extends Error {
    constructor(
      readonly callback: { traceId?: string; returnTo: string },
      readonly failure: unknown,
    ) {
      super("callback failed");
    }
  }
  return {
    CannotUnlinkLastIdentityError,
    IdentityAlreadyLinkedError,
    SsoProviderError,
    SsoAuthenticationError,
    SsoCallbackCompletionError,
    createClient: vi.fn(() => ({ client: true })),
    createStore: vi.fn(() => ({ store: true })),
    createLinker: vi.fn<() => unknown>(() => ({ linker: true })),
    createResolver: vi.fn(() => ({ resolver: true })),
    getStatus: vi.fn(),
    unlink: vi.fn(),
    invalidateSessions: vi.fn(),
    logoutSession: vi.fn(),
    issueSession: vi.fn(),
    rotateSession: vi.fn(),
    linkIdentity: vi.fn(),
    startLinking: vi.fn(),
    startLogin: vi.fn(),
    completeCallback: vi.fn(),
    cancelAuthentication: vi.fn(),
    putHandoff: vi.fn(),
    handoffStatus: vi.fn(),
    consumeReadyHandoff: vi.fn(),
    markHandoff: vi.fn(),
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
            IdentityAlreadyLinkedError: mocks.IdentityAlreadyLinkedError,
          },
        },
      },
    },
  };
});
vi.mock("../infrastructure/authentication/sso-provider-runtime", () => ({
  createConfiguredSsoProvider: mocks.createClient,
  ssoIdentityProviderPolicy: {
    activeProviderKey: "gcp_identity_platform",
  },
}));
vi.mock("../logic/authentication/sso-provider", () => ({
  SsoProviderError: mocks.SsoProviderError,
}));
vi.mock("../infrastructure/authentication/application-session-runtime", () => ({
  APPLICATION_SESSION_COOKIE: "__Host-me_builder_session",
  createApplicationSessionService: vi.fn(() => ({
    db: { db: true },
    sessions: {
      invalidateAccountSessions: mocks.invalidateSessions,
      issue: mocks.issueSession,
      logout: mocks.logoutSession,
      rotate: mocks.rotateSession,
    },
  })),
}));
vi.mock("../infrastructure/authentication/sso-transaction-store", () => ({
  createSsoTransactionStore: mocks.createStore,
}));
vi.mock("../infrastructure/authentication/sso-link-handoff-store", () => ({
  hashSsoLinkSecret: vi.fn(async (value: string) => `hash:${value}`),
  createSsoLinkHandoffStore: vi.fn(() => ({
    put: mocks.putHandoff,
    status: mocks.handoffStatus,
    consumeReady: mocks.consumeReadyHandoff,
    mark: mocks.markHandoff,
    stager: { stage: vi.fn() },
  })),
}));
vi.mock("../infrastructure/authentication/sso-identity-repository", () => ({
  createSsoExistingIdentityResolver: mocks.createResolver,
  createSsoIdentityLinker: mocks.createLinker,
  getSsoIdentityStatus: mocks.getStatus,
  unlinkSsoIdentity: mocks.unlink,
}));
vi.mock("../logic/authentication/sso-transaction", () => ({
  SsoAuthenticationError: mocks.SsoAuthenticationError,
  SsoCallbackCompletionError: mocks.SsoCallbackCompletionError,
  startSsoIdentityLinking: mocks.startLinking,
  startSsoAuthentication: mocks.startLogin,
  completeSsoCallback: mocks.completeCallback,
  cancelSsoAuthentication: mocks.cancelAuthentication,
}));

import {
  deleteSsoIdentity,
  getSsoCallback,
  getSsoIdentityStatusContents,
  getSsoLinkAttempt,
  postSsoIdentityLink,
  postSsoLinkAttemptConfirmation,
  postSsoLogin,
} from "./sso-identity";

const env = {
  ENVIRONMENT: "preview",
  WEB_ORIGIN: "https://stg.example.com",
  BASE_URL: "https://api.stg.example.com",
  SSO_ROLLOUT_MODE: "linking",
  GOOGLE_IDENTITY_PLATFORM_API_KEY: "identity-platform-api-key",
  GOOGLE_IDENTITY_PLATFORM_TENANT_ID: "development-tenant",
  GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
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
    mocks.rotateSession.mockResolvedValue({
      sessionToken: "rotated-session",
      csrfToken: "rotated-csrf-token",
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
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
    expect(mocks.getStatus).toHaveBeenCalledWith(
      expect.anything(),
      "account-at-start",
      expect.objectContaining({ activeProviderKey: "gcp_identity_platform" }),
    );
  });

  it("認証済みAccountと相対returnToをlink transactionへ固定して認可URLを返す", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    const log = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    mocks.startLinking.mockResolvedValue(
      new URL("https://accounts.google.com/o/oauth2/v2/auth?state=opaque"),
    );
    const response = await testApp("/api/auth/sso/link", postSsoIdentityLink).request(
      "https://api.example.com/api/auth/sso/link?returnTo=%2Fprofile",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      flow: "same-browser",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-me_builder_sso_callback_state=opaque",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(mocks.createStore).toHaveBeenCalledWith({ db: true }, env.SESSION_STORE);
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
      "[SSO] succeeded at authorization.create -> provider-redirect",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("account-at-start");
  });

  it("LIFF handoffではOAuth stateと別の確認情報を返して短命attemptを保存する", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    mocks.startLinking.mockResolvedValue(
      new URL("https://accounts.google.com/o/oauth2/v2/auth?state=liff.opaque"),
    );
    const response = await testApp("/api/auth/sso/link", postSsoIdentityLink).request(
      "https://api.example.com/api/auth/sso/link?handoff=liff",
      { method: "POST" },
      env,
    );

    const body = (await response.json()) as Record<string, string>;
    expect(response.status).toBe(200);
    expect(body.flow).toBe("liff-handoff");
    expect(body.authorizationUrl).toContain("state=liff.opaque");
    expect(body.attemptId).toBe("00000000-0000-4000-8000-000000000002");
    expect(body.confirmationSecret).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(mocks.putHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: body.attemptId,
        accountId: "account-at-start",
        confirmationSecretHash: `hash:${body.confirmationSecret}`,
        ttlSeconds: 600,
      }),
    );
    expect(mocks.startLinking).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff: {
          attemptId: body.attemptId,
          confirmationSecretHash: `hash:${body.confirmationSecret}`,
        },
      }),
    );
  });

  it("LIFFの状態確認は現在のAccountと開始元だけの確認secretへ束縛する", async () => {
    mocks.handoffStatus.mockResolvedValue("ready");
    const response = await testApp(
      "/api/auth/sso/link-attempts/:attemptId",
      getSsoLinkAttempt,
    ).request(
      "https://api.example.com/api/auth/sso/link-attempts/attempt-1",
      { headers: { "X-SSO-Link-Confirmation": "confirmation-secret" } },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(mocks.handoffStatus).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      accountId: "account-at-start",
      confirmationSecret: "confirmation-secret",
    });
  });

  it("LIFFでの確定後は元sessionの期限と表示情報を保つrotationを行う", async () => {
    mocks.consumeReadyHandoff.mockResolvedValue({
      providerKey: "gcp_identity_platform",
      subject: "google-subject",
      authenticationMethod: "sso",
      authenticatedAt: new Date("2026-08-27T00:00:00.000Z"),
    });
    mocks.createLinker.mockReturnValueOnce({ link: mocks.linkIdentity });
    mocks.linkIdentity.mockResolvedValue("google-identity");
    mocks.getStatus.mockResolvedValue({ linked: true, canUnlink: true });
    const response = await testApp(
      "/api/auth/sso/link-attempts/:attemptId/confirmation",
      postSsoLinkAttemptConfirmation,
    ).request(
      "https://api.example.com/api/auth/sso/link-attempts/attempt-1/confirmation",
      {
        method: "POST",
        headers: {
          Cookie: "__Host-me_builder_session=existing-liff-session",
          "X-SSO-Link-Confirmation": "confirmation-secret",
        },
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ linked: true, canUnlink: true });
    expect(mocks.linkIdentity).toHaveBeenCalledWith({
      accountId: "account-at-start",
      providerKey: "gcp_identity_platform",
      subject: "google-subject",
    });
    expect(mocks.rotateSession).toHaveBeenCalledWith("existing-liff-session");
    expect(mocks.logoutSession).not.toHaveBeenCalled();
    expect(mocks.issueSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-me_builder_session=rotated-session",
    );
  });

  it("別Accountに接続済みのGoogle Identityを奪わず固定409で拒否する", async () => {
    mocks.consumeReadyHandoff.mockResolvedValue({
      providerKey: "gcp_identity_platform",
      subject: "google-subject",
      authenticationMethod: "sso",
      authenticatedAt: new Date("2026-08-27T00:00:00.000Z"),
    });
    mocks.createLinker.mockReturnValueOnce({ link: mocks.linkIdentity });
    mocks.linkIdentity.mockRejectedValue(new mocks.IdentityAlreadyLinkedError());
    const response = await testApp(
      "/api/auth/sso/link-attempts/:attemptId/confirmation",
      postSsoLinkAttemptConfirmation,
    ).request(
      "https://api.example.com/api/auth/sso/link-attempts/attempt-1/confirmation",
      {
        method: "POST",
        headers: {
          Cookie: "__Host-me_builder_session=existing-liff-session",
          "X-SSO-Link-Confirmation": "confirmation-secret",
        },
      },
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "SSO link attempt cannot be confirmed" });
    expect(mocks.rotateSession).not.toHaveBeenCalled();
  });

  it("LIFF handoff callbackはcallback cookieなしでもpending化より先へ進まない", async () => {
    mocks.completeCallback.mockResolvedValue({
      purpose: "link-handoff",
      attemptId: "attempt-1",
      returnTo: "/profile",
    });
    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=liff.opaque&code=code",
      undefined,
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(mocks.completeCallback).toHaveBeenCalledWith(
      expect.objectContaining({ state: "liff.opaque", handoffStager: expect.anything() }),
    );
    expect(mocks.rotateSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).not.toContain("me_builder_session=");
  });

  it("link callback成功後は保存済みpathだけへ復帰する", async () => {
    const log = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    mocks.completeCallback.mockResolvedValue({
      purpose: "link",
      accountId: "account-at-start",
      authenticatedIdentityId: "identity-platform-identity",
      authenticationMethod: "sso",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      providerKey: "gcp_identity_platform",
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
      "identity-platform-identity",
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
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/opaque|code|identity-platform-uid/u);
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

  it("Accountを変えずに拒否した理由を安全な固定結果として記録する", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    mocks.completeCallback.mockRejectedValue(
      new mocks.SsoAuthenticationError("identity_unlinked", {
        traceId: "trace-unlinked",
        returnTo: "/profile",
      }),
    );

    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=sensitive-state&code=sensitive-code",
      { headers: { Cookie: "__Host-me_builder_sso_callback_state=sensitive-state" } },
      env,
    );

    expect(response.status).toBe(302);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "sso.callback.failed",
        traceId: "trace-unlinked",
        errorCode: "SSO_CALLBACK_FAILED",
        resultCode: "SSO_IDENTITY_UNLINKED",
      }),
      expect.stringContaining("SSO_CALLBACK_FAILED"),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/sensitive/u);
  });

  it("code交換のprovider障害を保存済みtraceと復帰先へ関連付ける", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    mocks.completeCallback.mockRejectedValue(
      new mocks.SsoCallbackCompletionError(
        { traceId: "trace-token-exchange", returnTo: "/diagnosis/result?from=share" },
        new mocks.SsoProviderError("provider_rejected"),
      ),
    );

    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=sensitive-state&code=sensitive-code",
      { headers: { Cookie: "__Host-me_builder_sso_callback_state=sensitive-state" } },
      env,
    );

    expect(response.headers.get("location")).toBe(
      "https://stg.example.com/diagnosis/result?from=share&sso=error",
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-token-exchange",
        errorCode: "SSO_PROVIDER_CALLBACK_FAILED",
        errorCategory: "external",
        retryable: true,
      }),
      expect.stringContaining("SSO_PROVIDER_CALLBACK_FAILED"),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/sensitive/u);
  });

  it("linked-login公開時だけ外部ブラウザのSSOログインを開始する", async () => {
    mocks.startLogin.mockResolvedValue(
      new URL("https://accounts.google.com/o/oauth2/v2/auth?state=login"),
    );
    const response = await testApp("/api/auth/sso/login", postSsoLogin).request(
      "https://api.example.com/api/auth/sso/login?returnTo=%2Fadmin",
      { method: "POST" },
      { ...env, SSO_ROLLOUT_MODE: "linked-login" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      flow: "same-browser",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=login",
    });
    expect(mocks.startLogin).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/admin" }));
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-me_builder_sso_callback_state=login",
    );
  });

  it("disabledではSSO loginとIdentity追加を開始しない", async () => {
    const disabledEnv = { ...env, SSO_ROLLOUT_MODE: "disabled" };
    const login = await testApp("/api/auth/sso/login", postSsoLogin).request(
      "https://api.example.com/api/auth/sso/login",
      { method: "POST" },
      disabledEnv,
    );
    const linking = await testApp("/api/auth/sso/link", postSsoIdentityLink).request(
      "https://api.example.com/api/auth/sso/link",
      { method: "POST" },
      disabledEnv,
    );

    expect(login.status).toBe(503);
    expect(linking.status).toBe(503);
    expect(mocks.startLogin).not.toHaveBeenCalled();
    expect(mocks.startLinking).not.toHaveBeenCalled();
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

  it("別Accountへのloginでは旧token自身のAccountを失効してから新sessionを発行する", async () => {
    mocks.issueSession.mockResolvedValue({
      sessionToken: "new-account-session",
      csrfToken: "csrf-token",
      expiresAt: new Date("2026-09-16T00:00:00.000Z"),
    });
    mocks.completeCallback.mockImplementation(
      async (input: {
        sessionIssuer: {
          issue(actor: {
            accountId: string;
            authenticatedIdentityId: string;
            authenticationMethod: "sso";
            authenticatedAt: Date;
          }): Promise<unknown>;
        };
      }) => ({
        purpose: "login" as const,
        session: await input.sessionIssuer.issue({
          accountId: "new-account",
          authenticatedIdentityId: "new-identity",
          authenticationMethod: "sso",
          authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
        }),
        returnTo: "/profile",
      }),
    );

    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=login&code=code",
      {
        headers: {
          Cookie:
            "__Host-me_builder_sso_callback_state=login; __Host-me_builder_session=old-account-session",
        },
      },
      { ...env, SSO_ROLLOUT_MODE: "linked-login" },
    );

    expect(response.status).toBe(302);
    expect(mocks.logoutSession).toHaveBeenCalledWith("old-account-session");
    expect(mocks.logoutSession).not.toHaveBeenCalledWith("old-account-session", "new-account");
    expect(mocks.logoutSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.issueSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("session issuer障害ではapplication session cookieを発行しない", async () => {
    mocks.issueSession.mockResolvedValue(undefined);
    mocks.completeCallback.mockImplementation(
      async (input: {
        sessionIssuer: {
          issue(actor: {
            accountId: string;
            authenticatedIdentityId: string;
            authenticationMethod: "sso";
            authenticatedAt: Date;
          }): Promise<unknown>;
        };
      }) => {
        await input.sessionIssuer.issue({
          accountId: "account-at-start",
          authenticatedIdentityId: "identity-platform-identity",
          authenticationMethod: "sso",
          authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
        });
        throw new Error("callback must not complete");
      },
    );

    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=login&code=code",
      { headers: { Cookie: "__Host-me_builder_sso_callback_state=login" } },
      { ...env, SSO_ROLLOUT_MODE: "linked-login" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://stg.example.com/profile?sso=error");
    expect(response.headers.get("set-cookie")).not.toContain("__Host-me_builder_session=");
  });

  it("認可endpoint障害はtrace付きで記録して503へ縮退する", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000003");
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    mocks.startLogin.mockRejectedValue(new mocks.SsoProviderError("configuration"));

    const response = await testApp("/api/auth/sso/login", postSsoLogin).request(
      "https://api.example.com/api/auth/sso/login",
      { method: "POST" },
      { ...env, SSO_ROLLOUT_MODE: "linked-login" },
    );

    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "sso.authentication.failed",
        traceId: "00000000-0000-4000-8000-000000000003",
        errorCode: "SSO_PROVIDER_UNAVAILABLE",
      }),
      expect.stringContaining("SSO_PROVIDER_UNAVAILABLE"),
    );
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

  it("IdP障害はキャンセル成功率へ混ぜずtrace付きの外部障害として記録する", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    mocks.cancelAuthentication.mockResolvedValue({
      purpose: "login",
      returnTo: "/diagnosis/result",
      traceId: "trace-provider-failure",
    });
    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=opaque&error=temporarily_unavailable",
      { headers: { Cookie: "__Host-me_builder_sso_callback_state=opaque" } },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://stg.example.com/diagnosis/result?sso=error",
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "sso.callback.failed",
        traceId: "trace-provider-failure",
        stage: "authorization.callback",
        errorCode: "SSO_PROVIDER_CALLBACK_FAILED",
        errorCategory: "external",
        retryable: true,
      }),
      expect.stringContaining("SSO_PROVIDER_CALLBACK_FAILED"),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/opaque|temporarily_unavailable/u);
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
    expect(mocks.unlink).toHaveBeenCalledWith(
      expect.anything(),
      "account-at-start",
      expect.objectContaining({ activeProviderKey: "gcp_identity_platform" }),
    );
    expect(mocks.invalidateSessions).toHaveBeenCalledWith("account-at-start");
    expect(response.headers.get("set-cookie")).toContain("__Host-me_builder_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
