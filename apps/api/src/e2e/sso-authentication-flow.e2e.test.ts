import { describe, expect, it, vi } from "vitest";
import { createSsoRolloutAuthorizer } from "../infrastructure/authentication/sso-rollout";
import type { ExternalSsoProvider } from "../logic/authentication/sso-provider";
import {
  SsoAuthenticationError,
  type SsoAuthenticationTransaction,
  type SsoAuthenticationTransactionStore,
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

function identityPlatformFixture(): ExternalSsoProvider {
  return {
    async createAuthorizationUrl({ state, nonce, codeChallenge }) {
      const url = new URL("https://accounts.google.test/o/oauth2/v2/auth");
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
        providerKey: "gcp_identity_platform",
        subject: "identity-platform-fixture-user",
        authenticationMethod: "sso",
        authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      };
    },
  };
}

async function startFlow(store: SsoAuthenticationTransactionStore, client: ExternalSsoProvider) {
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
  it("Google認証開始から既知Identityのsession発行と要求path復元までを一度だけ完了する", async () => {
    const store = memoryStore();
    const client = identityPlatformFixture();
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
            authenticatedIdentityId: "identity-platform-admin",
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
      authenticatedIdentityId: "identity-platform-admin",
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
    const client = identityPlatformFixture();
    const sessionIssuer = { issue: vi.fn(async () => ({ cookie: "opaque-session" })) };
    const knownUser = {
      findAccount: vi.fn(async () => ({
        accountId: "known-user",
        authenticatedIdentityId: "identity-platform-user",
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

  it("同じemailを持つ既存Accountがあっても別subjectのIdentityを統合しない", async () => {
    const store = memoryStore();
    const client = {
      ...identityPlatformFixture(),
      async exchangeAuthorizationCode() {
        return {
          providerKey: "gcp_identity_platform" as const,
          subject: "identity-platform-different-subject",
          authenticationMethod: "sso" as const,
          authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
          displayProfile: { displayName: "same-address@example.test" },
          email: "same-address@example.test",
        };
      },
    };
    const state = await startFlow(store, client);
    const findAccount = vi.fn(async (identity: { providerKey: string; subject: string }) =>
      "email" in identity
        ? {
            accountId: "existing-same-email-account",
            authenticatedIdentityId: "different-identity",
            role: "user" as const,
          }
        : undefined,
    );
    const sessionIssuer = { issue: vi.fn() };

    await expect(
      completeSsoLogin({
        state,
        code: "authorization-code",
        store,
        client,
        identityResolver: { findAccount },
        rolloutAuthorizer: createSsoRolloutAuthorizer(100),
        sessionIssuer,
        now: () => 2_000,
      }),
    ).rejects.toMatchObject({ reason: "identity_unlinked" });
    expect(findAccount).toHaveBeenCalledWith({
      providerKey: "gcp_identity_platform",
      subject: "identity-platform-different-subject",
    });
    expect(sessionIssuer.issue).not.toHaveBeenCalled();
  });

  it("session issuer障害ではcallbackを完了せずtransaction再送も拒否する", async () => {
    const store = memoryStore();
    const client = identityPlatformFixture();
    const state = await startFlow(store, client);
    const input = {
      state,
      code: "authorization-code",
      store,
      client,
      identityResolver: {
        findAccount: vi.fn(async () => ({
          accountId: "known-user",
          authenticatedIdentityId: "identity-platform-user",
          role: "user" as const,
        })),
      },
      rolloutAuthorizer: createSsoRolloutAuthorizer(100),
      sessionIssuer: {
        issue: vi.fn(async () => {
          throw new Error("issuer unavailable");
        }),
      },
      now: () => 2_000,
    };

    await expect(completeSsoLogin(input)).rejects.toMatchObject({
      callback: {
        returnTo: "/compatibility/invitations/invite-fixture",
        traceId: "00000000-0000-4000-8000-000000000099",
      },
    });
    await expect(completeSsoLogin(input)).rejects.toEqual(
      new SsoAuthenticationError("transaction_missing"),
    );
  });
});
