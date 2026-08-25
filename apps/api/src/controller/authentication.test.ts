import { type Handler, Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationResult } from "../logic/authentication/types";
import type { AppEnv } from "../types";

const mocks = vi.hoisted(() => ({
  authenticateLiff: vi.fn(),
  createLineCredentialVerifier: vi.fn(() => ({ verifier: true })),
  createApplicationSessionService: vi.fn(),
  logout: vi.fn(),
  issue: vi.fn(),
  clientState: vi.fn(),
}));

vi.mock("../logic/authentication/authenticate-liff", () => ({
  authenticateLiff: mocks.authenticateLiff,
}));
vi.mock("../infrastructure/authentication/line-credential-verifier", () => ({
  createLineCredentialVerifier: mocks.createLineCredentialVerifier,
}));
vi.mock("../infrastructure/authentication/application-session-runtime", () => ({
  APPLICATION_SESSION_COOKIE: "__Host-me_builder_session",
  createApplicationSessionService: mocks.createApplicationSessionService,
}));

import {
  deleteApplicationSession,
  getApplicationSession,
  postLiffAuthenticationExchange,
  setApplicationSessionCookie,
} from "./authentication";

const env = {
  ENVIRONMENT: "test",
  SSO_ROLLOUT_MODE: "disabled",
  WEB_ORIGIN: "https://web.example.com",
  SESSION_STORE: {},
  DB: {},
} as AppEnv["Bindings"];

const authenticated = {
  type: "authenticated",
  actor: {
    accountId: "account-1",
    authenticationMethod: "liff",
    authenticatedAt: new Date("2026-08-17T00:00:00.000Z"),
  },
  authenticatedIdentityId: "identity-1",
  accountRole: "user",
  displayProfile: { displayName: "テストユーザー" },
} satisfies AuthenticationResult;

type SessionContext = {
  source?: "application-session";
  token?: string;
  result?: AuthenticationResult;
};

function testApp(
  method: "get" | "post" | "delete",
  handler: Handler<AppEnv>,
  session: SessionContext = {},
) {
  const app = new Hono<AppEnv>();
  app.use("/", async (c, next) => {
    if (session.source) c.set("authenticationSource", session.source);
    if (session.token) c.set("applicationSessionToken", session.token);
    if (session.result) c.set("authenticationResult", session.result);
    await next();
  });
  app[method]("/", handler);
  return app;
}

function runtime() {
  return {
    db: { db: true },
    sessions: {
      logout: mocks.logout,
      issue: mocks.issue,
      clientState: mocks.clientState,
    },
  };
}

describe("application session controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createApplicationSessionService.mockReturnValue(runtime());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("許可済みWeb Origin以外からのLIFF交換を依存処理前に拒否する", async () => {
    const response = await testApp("post", postLiffAuthenticationExchange).request(
      "https://api.example.com/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
        body: JSON.stringify({ idToken: "id-token" }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(mocks.createApplicationSessionService).not.toHaveBeenCalled();
  });

  it("session基盤または入力が利用できないLIFF交換を固定エラーへ変換する", async () => {
    mocks.createApplicationSessionService.mockReturnValueOnce(undefined);
    const unavailable = await testApp("post", postLiffAuthenticationExchange).request(
      "https://api.example.com/",
      { method: "POST", headers: { Origin: env.WEB_ORIGIN ?? "" } },
      env,
    );
    expect(unavailable.status).toBe(503);

    const invalid = await testApp("post", postLiffAuthenticationExchange).request(
      "https://api.example.com/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: env.WEB_ORIGIN ?? "" },
        body: JSON.stringify({ idToken: "" }),
      },
      env,
    );
    expect(invalid.status).toBe(401);
    expect(mocks.authenticateLiff).not.toHaveBeenCalled();
  });

  it.each([
    ["authentication_not_configured", 503],
    ["credential_invalid", 401],
  ] as const)("LIFF認証失敗 %s をHTTP %iへ変換する", async (reason, status) => {
    mocks.authenticateLiff.mockResolvedValue({ type: "unauthenticated", reason });

    const response = await testApp("post", postLiffAuthenticationExchange).request(
      "https://api.example.com/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: env.WEB_ORIGIN ?? "" },
        body: JSON.stringify({ idToken: "id-token" }),
      },
      env,
    );

    expect(response.status).toBe(status);
  });

  it("以前のsessionを失効してから現在versionのsessionを発行する", async () => {
    mocks.authenticateLiff.mockResolvedValue(authenticated);
    mocks.issue.mockResolvedValue({
      sessionToken: "new-session",
      csrfToken: "csrf-token",
      expiresAt: new Date("2026-08-18T00:00:00.000Z"),
    });

    const response = await testApp("post", postLiffAuthenticationExchange).request(
      "https://api.example.com/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: env.WEB_ORIGIN ?? "",
          Cookie: "__Host-me_builder_session=old-session",
        },
        body: JSON.stringify({ idToken: "id-token" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: true,
      authenticationMethod: "liff",
      csrfToken: "csrf-token",
      role: "user",
      displayProfile: { displayName: "テストユーザー" },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toContain("new-session");
    expect(mocks.logout).toHaveBeenCalledWith("old-session");
    expect(mocks.logout.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.issue.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.issue).toHaveBeenCalledWith(
      authenticated.actor,
      "identity-1",
      authenticated.displayProfile,
    );
  });

  it("Identityまたはsessionを発行できない認証結果を拒否する", async () => {
    mocks.authenticateLiff.mockResolvedValueOnce({
      ...authenticated,
      authenticatedIdentityId: undefined,
    });
    const withoutIdentity = await testApp("post", postLiffAuthenticationExchange).request(
      "https://api.example.com/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: env.WEB_ORIGIN ?? "" },
        body: JSON.stringify({ idToken: "id-token" }),
      },
      env,
    );
    expect(withoutIdentity.status).toBe(401);
    expect(mocks.issue).not.toHaveBeenCalled();

    mocks.authenticateLiff.mockResolvedValueOnce(authenticated);
    mocks.issue.mockResolvedValueOnce(undefined);
    const withoutSession = await testApp("post", postLiffAuthenticationExchange).request(
      "https://api.example.com/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: env.WEB_ORIGIN ?? "" },
        body: JSON.stringify({ idToken: "id-token" }),
      },
      env,
    );
    expect(withoutSession.status).toBe(401);
  });

  it("application session以外ではsession参照とlogoutを拒否する", async () => {
    const getResponse = await testApp("get", getApplicationSession).request(
      "https://api.example.com/",
      undefined,
      env,
    );
    const deleteResponse = await testApp("delete", deleteApplicationSession).request(
      "https://api.example.com/",
      { method: "DELETE" },
      env,
    );

    expect(getResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
    expect(mocks.createApplicationSessionService).not.toHaveBeenCalled();
  });

  it("session基盤またはtokenがないsession参照を利用不可にする", async () => {
    mocks.createApplicationSessionService.mockReturnValueOnce(undefined);
    const unavailable = await testApp("get", getApplicationSession, {
      source: "application-session",
      token: "session-token",
    }).request("https://api.example.com/", undefined, env);
    expect(unavailable.status).toBe(503);

    const missingToken = await testApp("get", getApplicationSession, {
      source: "application-session",
    }).request("https://api.example.com/", undefined, env);
    expect(missingToken.status).toBe(503);
  });

  it("有効なsession stateだけをprovider非依存responseとして返す", async () => {
    mocks.clientState.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      csrfToken: "csrf-token",
      expiresAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    const session = {
      source: "application-session" as const,
      token: "session-token",
      result: authenticated,
    };

    const expired = await testApp("get", getApplicationSession, session).request(
      "https://api.example.com/",
      undefined,
      env,
    );
    expect(expired.status).toBe(401);

    const active = await testApp("get", getApplicationSession, session).request(
      "https://api.example.com/",
      undefined,
      env,
    );
    expect(active.status).toBe(200);
    expect(await active.json()).toMatchObject({ authenticated: true, csrfToken: "csrf-token" });
    expect(active.headers.get("Cache-Control")).toBe("no-store");
  });

  it("logoutでsessionを失効しhost-only cookieを削除する", async () => {
    const session = {
      source: "application-session" as const,
      token: "session-token",
      result: authenticated,
    };
    const response = await testApp("delete", deleteApplicationSession, session).request(
      "https://api.example.com/",
      { method: "DELETE" },
      env,
    );

    expect(response.status).toBe(204);
    expect(mocks.logout).toHaveBeenCalledWith("session-token", "account-1");
    expect(response.headers.get("Set-Cookie")).toContain("__Host-me_builder_session=");
    expect(response.headers.get("Set-Cookie")).not.toContain("Domain=");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("session基盤がないlogoutを利用不可にする", async () => {
    mocks.createApplicationSessionService.mockReturnValue(undefined);
    const response = await testApp("delete", deleteApplicationSession, {
      source: "application-session",
      token: "session-token",
      result: authenticated,
    }).request("https://api.example.com/", { method: "DELETE" }, env);

    expect(response.status).toBe(503);
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});

describe("application session cookie", () => {
  it("HttpOnly Secure SameSite=Laxのhost-only cookieとして発行する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    const app = new Hono<AppEnv>();
    app.get("/", (c) => {
      setApplicationSessionCookie(c, "opaque-session-token", new Date("2026-08-18T00:00:00Z"));
      return c.text("ok");
    });

    const response = await app.request("/");
    const cookie = response.headers.get("Set-Cookie") ?? "";

    expect(cookie).toContain("__Host-me_builder_session=opaque-session-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
  });
});
