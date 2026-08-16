import { type Handler, Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";

const mocks = vi.hoisted(() => {
  class CannotUnlinkLastIdentityError extends Error {}
  return {
    CannotUnlinkLastIdentityError,
    createClient: vi.fn(() => ({ client: true })),
    createStore: vi.fn(() => ({ store: true })),
    createLinker: vi.fn(() => ({ linker: true })),
    getStatus: vi.fn(),
    unlink: vi.fn(),
    startLinking: vi.fn(),
    completeLinking: vi.fn(),
    cancelLinking: vi.fn(),
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
vi.mock("../infrastructure/authentication/sso-transaction-store", () => ({
  createSsoTransactionStore: mocks.createStore,
}));
vi.mock("../infrastructure/authentication/sso-identity-repository", () => ({
  createSsoIdentityLinker: mocks.createLinker,
  getSsoIdentityStatus: mocks.getStatus,
  unlinkSsoIdentity: mocks.unlink,
}));
vi.mock("../logic/authentication/sso-transaction", () => ({
  startSsoIdentityLinking: mocks.startLinking,
  completeSsoIdentityLinking: mocks.completeLinking,
  cancelSsoIdentityLinking: mocks.cancelLinking,
}));

import {
  deleteSsoIdentity,
  getSsoCallback,
  getSsoIdentityLink,
  getSsoIdentityStatusContents,
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
  app.delete(path, handler);
  return app;
}

describe("SSO identity controller", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("認証済みAccountと相対returnToをlink transactionへ固定してAuth0へ遷移する", async () => {
    mocks.startLinking.mockResolvedValue(
      new URL("https://tenant.auth0.com/authorize?state=opaque"),
    );
    const response = await testApp("/api/auth/sso/link", getSsoIdentityLink).request(
      "https://api.example.com/api/auth/sso/link?returnTo=%2Fprofile",
      undefined,
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://tenant.auth0.com/authorize?state=opaque",
    );
    expect(response.headers.get("set-cookie")).toContain("__Host-me_builder_sso_link_state=opaque");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(mocks.createStore).toHaveBeenCalledWith(env.SESSION_STORE);
    expect(mocks.startLinking).toHaveBeenCalledWith(
      expect.objectContaining({ initiatingAccountId: "account-at-start", returnTo: "/profile" }),
    );
  });

  it("link callback成功後は保存済みpathだけへ復帰する", async () => {
    mocks.completeLinking.mockResolvedValue({ providerKey: "auth0", returnTo: "/profile" });
    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=opaque&code=code",
      { headers: { Cookie: "__Host-me_builder_sso_link_state=opaque" } },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://stg.example.com/profile?sso=linked");
    expect(mocks.completeLinking).toHaveBeenCalledWith(
      expect.objectContaining({ state: "opaque", code: "code" }),
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("IdPキャンセルでもtransactionを消費して固定pathへ復帰する", async () => {
    mocks.cancelLinking.mockResolvedValue({ returnTo: "/profile" });
    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=opaque&error=access_denied",
      { headers: { Cookie: "__Host-me_builder_sso_link_state=opaque" } },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://stg.example.com/profile?sso=cancelled");
    expect(mocks.cancelLinking).toHaveBeenCalledWith(expect.objectContaining({ state: "opaque" }));
  });

  it("開始browserと一致しないlink callbackをtransaction消費前に拒否する", async () => {
    const response = await testApp("/api/auth/sso/callback", getSsoCallback).request(
      "https://api.example.com/api/auth/sso/callback?state=transferred&code=code",
      { headers: { Cookie: "__Host-me_builder_sso_link_state=another" } },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://stg.example.com/profile?sso=error");
    expect(mocks.completeLinking).not.toHaveBeenCalled();
    expect(mocks.cancelLinking).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
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
  });
});
