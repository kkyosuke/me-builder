import type { KVNamespace } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import type { ApplicationSessionRecord } from "../../logic/authentication/application-session";
import { KvApplicationSessionStore } from "./kv-application-session-store";

const record: ApplicationSessionRecord = {
  accountId: "account-1",
  authenticationMethod: "liff",
  authenticatedAt: "2026-08-17T00:00:00.000Z",
  issuedAt: "2026-08-17T00:00:00.000Z",
  lastSeenAt: "2026-08-17T00:00:00.000Z",
  expiresAt: "2026-08-18T00:00:00.000Z",
  sessionVersion: 1,
  csrfToken: "csrf-token",
  authenticatedIdentityId: "identity-1",
  displayProfile: {
    displayName: "利用者A",
    pictureUrl: "https://example.com/picture.jpg",
  },
};

describe("KvApplicationSessionStore", () => {
  it("version付きprefixのhash参照へJSONを保存する", async () => {
    const namespace = {
      get: vi.fn().mockResolvedValue(record),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace;
    const store = new KvApplicationSessionStore(namespace);

    await expect(store.get("reference-hash")).resolves.toEqual(record);
    await store.put("reference-hash", record, 30);
    await store.delete("reference-hash");

    expect(namespace.get).toHaveBeenCalledWith("session:v2:reference-hash", "json");
    expect(namespace.put).toHaveBeenCalledWith(
      "session:v2:reference-hash",
      JSON.stringify(record),
      { expirationTtl: 60 },
    );
    expect(namespace.delete).toHaveBeenCalledWith("session:v2:reference-hash");
  });

  it("破損したKV recordを削除してfail-closedに扱う", async () => {
    const namespace = {
      get: vi.fn().mockResolvedValue({ ...record, expiresAt: "invalid-timestamp" }),
      put: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace;
    const store = new KvApplicationSessionStore(namespace);

    await expect(store.get("corrupted-reference")).resolves.toBeUndefined();
    expect(namespace.delete).toHaveBeenCalledWith("session:v2:corrupted-reference");
  });
});
