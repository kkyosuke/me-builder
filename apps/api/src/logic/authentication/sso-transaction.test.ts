import { describe, expect, it, vi } from "vitest";
import {
  SsoAuthenticationError,
  type SsoAuthenticationTransaction,
  type SsoAuthenticationTransactionStore,
  type SsoServerClient,
  cancelSsoAuthentication,
  completeSsoAuthentication,
  completeSsoCallback,
  completeSsoIdentityLinking,
  completeSsoLogin,
  normalizeSsoReturnTo,
  startSsoAuthentication,
  startSsoIdentityLinking,
} from "./sso-transaction";

function createMemoryStore(): SsoAuthenticationTransactionStore & {
  transactions: Map<string, SsoAuthenticationTransaction>;
} {
  const transactions = new Map<string, SsoAuthenticationTransaction>();
  return {
    transactions,
    async put(state, transaction) {
      transactions.set(state, transaction);
    },
    async consume(state) {
      const transaction = transactions.get(state);
      transactions.delete(state);
      return transaction;
    },
  };
}

function createClient(): SsoServerClient {
  return {
    createAuthorizationUrl: vi.fn(async ({ state }) => {
      return new URL(`https://tenant.auth0.com/authorize?state=${state}`);
    }),
    exchangeAuthorizationCode: vi.fn(async () => ({
      providerKey: "auth0" as const,
      subject: "auth0|user-1",
      authenticationMethod: "sso" as const,
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
    })),
  };
}

describe("normalizeSsoReturnTo", () => {
  it("同一originの絶対pathをquery・fragmentごと保持する", () => {
    expect(normalizeSsoReturnTo("/diagnoses/result?id=1#profile")).toBe(
      "/diagnoses/result?id=1#profile",
    );
  });

  it.each(["https://evil.example/", "//evil.example/", "/\\evil.example/", "diagnoses"])(
    "外部originへ遷移しうるreturnToを拒否する: %s",
    (returnTo) => {
      expect(() => normalizeSsoReturnTo(returnTo)).toThrowError(
        expect.objectContaining({ reason: "invalid_return_to" }),
      );
    },
  );

  it("上限を超えるreturnToを拒否する", () => {
    expect(() => normalizeSsoReturnTo(`/${"a".repeat(2048)}`)).toThrowError(
      expect.objectContaining({ reason: "invalid_return_to" }),
    );
  });
});

describe("SSO authentication transaction", () => {
  it("state・nonce・PKCEを短命transactionへ保存して認可URLを作る", async () => {
    const store = createMemoryStore();
    const client = createClient();
    let randomSeed = 0;

    const authorizationUrl = await startSsoAuthentication({
      traceId: "00000000-0000-4000-8000-000000000001",
      returnTo: "/settings/account",
      store,
      client,
      now: () => 1_000,
      randomBytes: (size) => new Uint8Array(size).fill(++randomSeed),
    });

    const state = authorizationUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(store.transactions.get(state ?? "")).toEqual({
      purpose: "login",
      traceId: "00000000-0000-4000-8000-000000000001",
      nonce: expect.any(String),
      codeVerifier: expect.any(String),
      returnTo: "/settings/account",
      expiresAt: 601_000,
    });
    expect(client.createAuthorizationUrl).toHaveBeenCalledWith({
      state,
      nonce: expect.any(String),
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
    });
  });

  it("認可endpointを解決できない場合は利用不能なtransactionを保存しない", async () => {
    const store = createMemoryStore();
    const client = createClient();
    vi.mocked(client.createAuthorizationUrl).mockRejectedValue(new Error("provider unavailable"));

    await expect(startSsoAuthentication({ returnTo: "/", store, client })).rejects.toThrow(
      "provider unavailable",
    );
    expect(store.transactions.size).toBe(0);
  });

  it("callbackでtransactionを一度だけ消費してidentityとreturnToを返す", async () => {
    const store = createMemoryStore();
    const client = createClient();
    store.transactions.set("state", {
      purpose: "login",
      traceId: "00000000-0000-4000-8000-000000000002",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/settings/account",
      expiresAt: 2_000,
    });

    await expect(
      completeSsoAuthentication({
        state: "state",
        code: "authorization-code",
        store,
        client,
        now: () => 1_000,
      }),
    ).resolves.toEqual({
      identity: expect.objectContaining({ providerKey: "auth0", subject: "auth0|user-1" }),
      returnTo: "/settings/account",
      traceId: "00000000-0000-4000-8000-000000000002",
    });
    expect(client.exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: "authorization-code",
      codeVerifier: "verifier",
      expectedNonce: "nonce",
    });
    await expect(
      completeSsoAuthentication({ state: "state", code: "code", store, client }),
    ).rejects.toEqual(new SsoAuthenticationError("transaction_missing"));
  });

  it("改ざんされたstateと期限切れtransactionを拒否する", async () => {
    const store = createMemoryStore();
    const client = createClient();
    store.transactions.set("expired", {
      purpose: "login",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/",
      expiresAt: 1_000,
    });

    await expect(
      completeSsoAuthentication({ state: "tampered", code: "code", store, client }),
    ).rejects.toEqual(new SsoAuthenticationError("transaction_missing"));
    await expect(
      completeSsoAuthentication({
        state: "expired",
        code: "code",
        store,
        client,
        now: () => 1_000,
      }),
    ).rejects.toEqual(new SsoAuthenticationError("transaction_expired"));
    expect(client.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("stateまたはcodeが欠けるcallbackを拒否する", async () => {
    const store = createMemoryStore();
    const client = createClient();

    await expect(
      completeSsoAuthentication({ state: "", code: "code", store, client }),
    ).rejects.toEqual(new SsoAuthenticationError("invalid_callback"));
    await expect(
      completeSsoAuthentication({ state: "state", code: "", store, client }),
    ).rejects.toEqual(new SsoAuthenticationError("invalid_callback"));
  });

  it("link済みIdentityだけを共通session issuerへ渡す", async () => {
    const store = createMemoryStore();
    const client = createClient();
    store.transactions.set("state", {
      purpose: "login",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/diagnoses",
      expiresAt: 2_000,
    });
    const identityResolver = {
      findAccount: vi.fn(async () => ({
        accountId: "account-1",
        authenticatedIdentityId: "identity-auth0",
        role: "user" as const,
      })),
    };
    const sessionIssuer = {
      issue: vi.fn(async () => ({ cookie: "opaque-cookie" })),
    };

    await expect(
      completeSsoLogin({
        state: "state",
        code: "code",
        store,
        client,
        identityResolver,
        sessionIssuer,
        now: () => 1_000,
      }),
    ).resolves.toEqual({
      session: { cookie: "opaque-cookie" },
      returnTo: "/diagnoses",
    });
    expect(identityResolver.findAccount).toHaveBeenCalledWith({
      providerKey: "auth0",
      subject: "auth0|user-1",
    });
    expect(sessionIssuer.issue).toHaveBeenCalledWith({
      accountId: "account-1",
      authenticatedIdentityId: "identity-auth0",
      authenticationMethod: "sso",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
    });
  });

  it("未知IdentityはAccountを自動作成せずlink-only結果として拒否する", async () => {
    const store = createMemoryStore();
    const client = createClient();
    store.transactions.set("state", {
      purpose: "login",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/",
      expiresAt: 2_000,
    });
    const sessionIssuer = { issue: vi.fn() };

    await expect(
      completeSsoLogin({
        state: "state",
        code: "code",
        store,
        client,
        identityResolver: { findAccount: vi.fn(async () => undefined) },
        sessionIssuer,
        now: () => 1_000,
      }),
    ).rejects.toEqual(new SsoAuthenticationError("identity_unlinked"));
    expect(sessionIssuer.issue).not.toHaveBeenCalled();
  });

  it("共通callbackはlogin transactionを解決してsessionを発行する", async () => {
    const store = createMemoryStore();
    const client = createClient();
    store.transactions.set("login-state", {
      purpose: "login",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/admin",
      expiresAt: 2_000,
    });
    const identityLinker = { link: vi.fn() };
    const sessionIssuer = { issue: vi.fn(async () => ({ token: "session" })) };

    await expect(
      completeSsoCallback({
        state: "login-state",
        code: "code",
        store,
        client,
        identityResolver: {
          findAccount: vi.fn(async () => ({
            accountId: "account-1",
            authenticatedIdentityId: "identity-auth0",
            role: "user" as const,
          })),
        },
        identityLinker,
        sessionIssuer,
        now: () => 1_000,
      }),
    ).resolves.toEqual({ purpose: "login", session: { token: "session" }, returnTo: "/admin" });
    expect(identityLinker.link).not.toHaveBeenCalled();
  });

  it("共通callbackはlink transactionを開始時Accountへだけ接続する", async () => {
    const store = createMemoryStore();
    const client = createClient();
    store.transactions.set("link-state", {
      purpose: "link",
      initiatingAccountId: "account-at-start",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/profile",
      expiresAt: 2_000,
    });
    const identityLinker = { link: vi.fn(async () => "identity-auth0") };
    const sessionIssuer = { issue: vi.fn() };

    await expect(
      completeSsoCallback({
        state: "link-state",
        code: "code",
        store,
        client,
        identityResolver: { findAccount: vi.fn() },
        identityLinker,
        sessionIssuer,
        now: () => 1_000,
      }),
    ).resolves.toEqual({
      purpose: "link",
      accountId: "account-at-start",
      authenticatedIdentityId: "identity-auth0",
      authenticationMethod: "sso",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      providerKey: "auth0",
      returnTo: "/profile",
    });
    expect(sessionIssuer.issue).not.toHaveBeenCalled();
  });

  it("Identity追加開始時のAccountを短命transactionへ固定する", async () => {
    const store = createMemoryStore();
    const client = createClient();
    let randomSeed = 0;

    const authorizationUrl = await startSsoIdentityLinking({
      initiatingAccountId: "account-1",
      returnTo: "/profile?sso=linking",
      store,
      client,
      now: () => 1_000,
      randomBytes: (size) => new Uint8Array(size).fill(++randomSeed),
    });

    const state = authorizationUrl.searchParams.get("state") ?? "";
    expect(store.transactions.get(state)).toEqual({
      purpose: "link",
      initiatingAccountId: "account-1",
      nonce: expect.any(String),
      codeVerifier: expect.any(String),
      returnTo: "/profile?sso=linking",
      expiresAt: 601_000,
    });
  });

  it("callback時のsessionではなく開始時に固定したAccountへIdentityを追加する", async () => {
    const store = createMemoryStore();
    const client = createClient();
    store.transactions.set("link-state", {
      purpose: "link",
      initiatingAccountId: "account-at-start",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/profile?sso=linked",
      expiresAt: 2_000,
    });
    const identityLinker = { link: vi.fn(async () => "identity-auth0") };

    await expect(
      completeSsoIdentityLinking({
        state: "link-state",
        code: "code",
        store,
        client,
        identityLinker,
        now: () => 1_000,
      }),
    ).resolves.toEqual({
      accountId: "account-at-start",
      authenticatedIdentityId: "identity-auth0",
      authenticationMethod: "sso",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      providerKey: "auth0",
      returnTo: "/profile?sso=linked",
    });
    expect(identityLinker.link).toHaveBeenCalledWith({
      accountId: "account-at-start",
      providerKey: "auth0",
      subject: "auth0|user-1",
    });
    await expect(
      completeSsoIdentityLinking({
        state: "link-state",
        code: "code",
        store,
        client,
        identityLinker,
      }),
    ).rejects.toEqual(new SsoAuthenticationError("transaction_missing"));
  });

  it("loginとlinkのstateを別用途のcallbackへ差し替えられない", async () => {
    const store = createMemoryStore();
    const client = createClient();
    store.transactions.set("link-state", {
      purpose: "link",
      initiatingAccountId: "account-1",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/",
      expiresAt: 2_000,
    });
    store.transactions.set("login-state", {
      purpose: "login",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/",
      expiresAt: 2_000,
    });

    await expect(
      completeSsoAuthentication({
        state: "link-state",
        code: "code",
        store,
        client,
        now: () => 1_000,
      }),
    ).rejects.toEqual(new SsoAuthenticationError("transaction_purpose_mismatch"));
    await expect(
      completeSsoIdentityLinking({
        state: "login-state",
        code: "code",
        store,
        client,
        identityLinker: { link: vi.fn() },
        now: () => 1_000,
      }),
    ).rejects.toEqual(new SsoAuthenticationError("transaction_purpose_mismatch"));
  });

  it.each([
    { purpose: "login" as const, returnTo: "/diagnosis" },
    { purpose: "link" as const, initiatingAccountId: "account-1", returnTo: "/profile" },
  ])(
    "IdPでキャンセルした$purpose transactionを元のpathへ戻して再送拒否する",
    async (transaction) => {
      const store = createMemoryStore();
      store.transactions.set("cancel-state", {
        ...transaction,
        traceId: "trace-cancel",
        nonce: "nonce",
        codeVerifier: "verifier",
        expiresAt: 2_000,
      });

      await expect(
        cancelSsoAuthentication({ state: "cancel-state", store, now: () => 1_000 }),
      ).resolves.toEqual({
        purpose: transaction.purpose,
        returnTo: transaction.returnTo,
        traceId: "trace-cancel",
      });
      await expect(
        cancelSsoAuthentication({ state: "cancel-state", store, now: () => 1_000 }),
      ).rejects.toEqual(new SsoAuthenticationError("transaction_missing"));
    },
  );
});
