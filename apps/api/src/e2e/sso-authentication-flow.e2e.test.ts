import { describe, expect, it, vi } from "vitest";
import { createSsoRolloutAuthorizer } from "../infrastructure/authentication/sso-rollout";
import {
  SsoAuthenticationError,
  type SsoAuthenticationTransaction,
  type SsoAuthenticationTransactionStore,
  type SsoServerClient,
  completeSsoLogin,
  startSsoAuthentication,
} from "../logic/authentication/sso-transaction";

function memoryStore(): SsoAuthenticationTransactionStore & {
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

function auth0Fixture(): SsoServerClient {
  return {
    async createAuthorizationUrl({ state, nonce, codeChallenge }) {
      const url = new URL("https://tenant.auth0.test/authorize");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url;
    },
    async exchangeAuthorizationCode({ code, codeVerifier, expectedNonce }) {
      expect(code).toBe("authorization-code");
      expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(expectedNonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      return {
        providerKey: "auth0",
        subject: "auth0|fixture-user",
        authenticationMethod: "sso",
        authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      };
    },
  };
}

async function startFlow(store: SsoAuthenticationTransactionStore, client: SsoServerClient) {
  let seed = 0;
  const authorizationUrl = await startSsoAuthentication({
    traceId: "00000000-0000-4000-8000-000000000099",
    returnTo: "/compatibility/invitations/invite-fixture",
    store,
    client,
    now: () => 1_000,
    randomBytes: (size) => new Uint8Array(size).fill(++seed),
  });
  return authorizationUrl.searchParams.get("state") ?? "";
}

describe("SSO authentication E2E", () => {
  it("Auth0開始から既知Identityのsession発行と要求path復元までを一度だけ完了する", async () => {
    const store = memoryStore();
    const client = auth0Fixture();
    const state = await startFlow(store, client);
    const sessionIssuer = { issue: vi.fn(async () => ({ cookie: "opaque-session" })) };

    await expect(
      completeSsoLogin({
        state,
        code: "authorization-code",
        store,
        client,
        identityResolver: {
          findAccount: vi.fn(async () => ({
            accountId: "admin-account",
            authenticatedIdentityId: "identity-auth0-admin",
            role: "admin" as const,
          })),
        },
        rolloutAuthorizer: createSsoRolloutAuthorizer(0),
        sessionIssuer,
        now: () => 2_000,
      }),
    ).resolves.toEqual({
      session: { cookie: "opaque-session" },
      returnTo: "/compatibility/invitations/invite-fixture",
      traceId: "00000000-0000-4000-8000-000000000099",
    });
    expect(sessionIssuer.issue).toHaveBeenCalledWith({
      accountId: "admin-account",
      authenticatedIdentityId: "identity-auth0-admin",
      authenticationMethod: "sso",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
    });

    await expect(
      completeSsoLogin({
        state,
        code: "authorization-code",
        store,
        client,
        identityResolver: { findAccount: vi.fn() },
        rolloutAuthorizer: createSsoRolloutAuthorizer(100),
        sessionIssuer,
      }),
    ).rejects.toEqual(new SsoAuthenticationError("transaction_missing"));
  });

  it("0%の一般Accountと未知Identityではsessionを発行せず、100%の既知Accountだけ許可する", async () => {
    const client = auth0Fixture();
    const sessionIssuer = { issue: vi.fn(async () => ({ cookie: "opaque-session" })) };
    const knownUser = {
      findAccount: vi.fn(async () => ({
        accountId: "known-user",
        authenticatedIdentityId: "identity-auth0-user",
        role: "user" as const,
      })),
    };

    const excludedStore = memoryStore();
    const excludedState = await startFlow(excludedStore, client);
    await expect(
      completeSsoLogin({
        state: excludedState,
        code: "authorization-code",
        store: excludedStore,
        client,
        identityResolver: knownUser,
        rolloutAuthorizer: createSsoRolloutAuthorizer(0),
        sessionIssuer,
        now: () => 2_000,
      }),
    ).rejects.toMatchObject({
      reason: "rollout_excluded",
      callback: {
        returnTo: "/compatibility/invitations/invite-fixture",
        traceId: "00000000-0000-4000-8000-000000000099",
      },
    });

    const unknownStore = memoryStore();
    const unknownState = await startFlow(unknownStore, client);
    await expect(
      completeSsoLogin({
        state: unknownState,
        code: "authorization-code",
        store: unknownStore,
        client,
        identityResolver: { findAccount: vi.fn(async () => undefined) },
        rolloutAuthorizer: createSsoRolloutAuthorizer(100),
        sessionIssuer,
        now: () => 2_000,
      }),
    ).rejects.toMatchObject({
      reason: "identity_unlinked",
      callback: {
        returnTo: "/compatibility/invitations/invite-fixture",
        traceId: "00000000-0000-4000-8000-000000000099",
      },
    });

    const allowedStore = memoryStore();
    const allowedState = await startFlow(allowedStore, client);
    await expect(
      completeSsoLogin({
        state: allowedState,
        code: "authorization-code",
        store: allowedStore,
        client,
        identityResolver: knownUser,
        rolloutAuthorizer: createSsoRolloutAuthorizer(100),
        sessionIssuer,
        now: () => 2_000,
      }),
    ).resolves.toMatchObject({ session: { cookie: "opaque-session" } });
    expect(sessionIssuer.issue).toHaveBeenCalledTimes(1);
  });
});
