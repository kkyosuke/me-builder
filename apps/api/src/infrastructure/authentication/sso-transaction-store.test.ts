import type { KVNamespace } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { createSsoTransactionStore } from "./sso-transaction-store";

describe("createSsoTransactionStore", () => {
  it("stateをhash化したkeyで保存し、読み出し時に先に削除する", async () => {
    const records = new Map<string, unknown>();
    const put = vi.fn(async (key: string, value: string) => {
      records.set(key, JSON.parse(value));
    });
    const deleteValue = vi.fn(async (key: string) => {
      records.delete(key);
    });
    const kv = {
      put,
      get: vi.fn(async (key: string) => records.get(key) ?? null),
      delete: deleteValue,
    } as unknown as KVNamespace;
    const store = createSsoTransactionStore(kv);

    await store.put(
      "raw-state",
      {
        purpose: "login",
        nonce: "nonce",
        codeVerifier: "verifier",
        returnTo: "/",
        expiresAt: 1_000,
      },
      600,
    );

    const key = put.mock.calls[0]?.[0];
    expect(key).toMatch(/^sso-transaction:[A-Za-z0-9_-]+$/u);
    expect(key).not.toContain("raw-state");
    await expect(store.consume("raw-state")).resolves.toEqual({
      purpose: "login",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/",
      expiresAt: 1_000,
    });
    expect(deleteValue).toHaveBeenCalledWith(key);
    await expect(store.consume("raw-state")).resolves.toBeUndefined();
  });

  it("不正な保存値をidentity verificationへ渡さない", async () => {
    const kv = {
      put: vi.fn(),
      get: vi.fn(async () => ({ nonce: "nonce" })),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    await expect(createSsoTransactionStore(kv).consume("state")).resolves.toBeUndefined();
  });
});
