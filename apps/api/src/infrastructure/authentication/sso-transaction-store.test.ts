import type { KVNamespace } from "@cloudflare/workers-types";
import type { D1 } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ claim: vi.fn() }));

vi.mock("@me-builder/lib", () => ({
  D1: {
    shared: {
      action: {
        ssoAuthentication: {
          claimSsoAuthenticationTransaction: mocks.claim,
        },
      },
    },
  },
}));

import { createSsoTransactionStore } from "./sso-transaction-store";

const transaction = {
  purpose: "login" as const,
  nonce: "nonce",
  codeVerifier: "verifier",
  returnTo: "/",
  expiresAt: Date.now() + 600_000,
};

function kvFixture(stored: unknown = transaction): KVNamespace {
  return {
    put: vi.fn(),
    get: vi.fn(async () => stored),
    delete: vi.fn(),
  } as unknown as KVNamespace;
}

describe("createSsoTransactionStore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stateをhash化したKV keyへ10分TTL付きでpayloadを保存する", async () => {
    const kv = kvFixture();
    const store = createSsoTransactionStore({} as D1.shared.Client, kv);

    await store.put("raw-state", transaction, 600);

    expect(kv.put).toHaveBeenCalledWith(
      expect.stringMatching(/^sso-transaction:[A-Za-z0-9_-]+$/u),
      JSON.stringify(transaction),
      { expirationTtl: 600 },
    );
    expect(vi.mocked(kv.put).mock.calls[0]?.[0]).not.toContain("raw-state");
  });

  it("同時にKVを読めてもD1 claimを得たcallbackだけがpayloadを消費する", async () => {
    const kv = kvFixture();
    mocks.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const store = createSsoTransactionStore({} as D1.shared.Client, kv);

    const consumed = await Promise.all([store.consume("state"), store.consume("state")]);

    expect(consumed.filter(Boolean)).toEqual([transaction]);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(kv.delete).toHaveBeenCalledTimes(1);
  });

  it.each([null, { nonce: "nonce" }])("不正な保存値をclaimせず拒否する: %j", async (stored) => {
    const kv = kvFixture(stored);
    await expect(
      createSsoTransactionStore({} as D1.shared.Client, kv).consume("state"),
    ).resolves.toBeUndefined();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(kv.delete).not.toHaveBeenCalled();
  });
});
