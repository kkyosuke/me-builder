import type { KVNamespace } from "@cloudflare/workers-types";
import type { D1 } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const claim = vi.hoisted(() => vi.fn());
vi.mock("@me-builder/lib", () => ({
  D1: { shared: { action: { ssoAuthentication: { claimSsoAuthenticationTransaction: claim } } } },
}));

import { createSsoLinkHandoffStore, hashSsoLinkSecret } from "./sso-link-handoff-store";

function kvFixture(): KVNamespace {
  const values = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => values.set(key, value)),
    get: vi.fn(async (key: string) => {
      const value = values.get(key);
      return value ? JSON.parse(value) : null;
    }),
    delete: vi.fn(async (key: string) => values.delete(key)),
  } as unknown as KVNamespace;
}

describe("SSO link handoff store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claim.mockResolvedValue(true);
  });

  it("callbackではpending化し、同じAccountとsecretの確定で一度だけIdentityを返す", async () => {
    const kv = kvFixture();
    const store = createSsoLinkHandoffStore({} as D1.shared.Client, kv);
    await store.put({
      attemptId: "attempt-1",
      accountId: "account-1",
      confirmationSecretHash: await hashSsoLinkSecret("secret"),
      expiresAt: Date.now() + 600_000,
      ttlSeconds: 600,
    });
    await store.stager.stage({
      attemptId: "attempt-1",
      accountId: "account-1",
      confirmationSecretHash: await hashSsoLinkSecret("secret"),
      identity: {
        providerKey: "gcp_identity_platform",
        subject: "google-subject",
        authenticationMethod: "sso",
        authenticatedAt: new Date("2026-08-27T00:00:00.000Z"),
      },
    });

    await expect(
      store.status({
        attemptId: "attempt-1",
        accountId: "account-1",
        confirmationSecret: "secret",
      }),
    ).resolves.toBe("ready");
    await expect(
      store.consumeReady({
        attemptId: "attempt-1",
        accountId: "account-1",
        confirmationSecret: "wrong",
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.consumeReady({
        attemptId: "attempt-1",
        accountId: "account-1",
        confirmationSecret: "secret",
      }),
    ).resolves.toMatchObject({ subject: "google-subject" });
    await expect(
      store.consumeReady({
        attemptId: "attempt-1",
        accountId: "account-1",
        confirmationSecret: "secret",
      }),
    ).resolves.toBeUndefined();
  });

  it("transactionとattemptの確認secretが一致しないcallbackをpending化しない", async () => {
    const kv = kvFixture();
    const store = createSsoLinkHandoffStore({} as D1.shared.Client, kv);
    await store.put({
      attemptId: "attempt-1",
      accountId: "account-1",
      confirmationSecretHash: await hashSsoLinkSecret("original-secret"),
      expiresAt: Date.now() + 600_000,
      ttlSeconds: 600,
    });

    await expect(
      store.stager.stage({
        attemptId: "attempt-1",
        accountId: "account-1",
        confirmationSecretHash: await hashSsoLinkSecret("different-secret"),
        identity: {
          providerKey: "gcp_identity_platform",
          subject: "google-subject",
          authenticationMethod: "sso",
          authenticatedAt: new Date("2026-08-27T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("unavailable");
    await expect(
      store.status({
        attemptId: "attempt-1",
        accountId: "account-1",
        confirmationSecret: "original-secret",
      }),
    ).resolves.toBe("waiting");
  });
});
