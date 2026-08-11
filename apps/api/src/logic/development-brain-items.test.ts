import type { AccountDataNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getDevelopmentBrainItems, getDevelopmentBrainVector } from "./development-brain-items";

const db = {} as D1.shared.Client;
const accountData = {} as AccountDataNamespace;
const vectorIndex = {} as ApiBindings["BRAIN_VECTOR_INDEX"];

function dependencies() {
  return {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user" },
    }),
    listActive: vi.fn().mockResolvedValue({ items: [], truncated: false }),
  };
}

describe("getDevelopmentBrainItems", () => {
  it("本人確認で解決したAccountのactive Itemを取得する", async () => {
    const deps = dependencies();

    await expect(
      getDevelopmentBrainItems(
        { idToken: "token", lineLoginChannelId: "channel", db, accountData },
        deps,
      ),
    ).resolves.toEqual({ type: "resolved", items: [], truncated: false });
    expect(deps.listActive).toHaveBeenCalledWith(accountData, "account-1");
  });

  it("本人を解決できなければAccountDataを参照しない", async () => {
    const deps = dependencies();
    deps.createSession.mockResolvedValue({ type: "unauthenticated", reason: "invalid" } as never);

    await expect(
      getDevelopmentBrainItems(
        { idToken: undefined, lineLoginChannelId: "channel", db, accountData },
        deps,
      ),
    ).resolves.toEqual({ type: "unauthenticated", reason: "invalid" });
    expect(deps.listActive).not.toHaveBeenCalled();
  });
});

describe("getDevelopmentBrainVector", () => {
  it("本人の対応表を使ってVectorize実体と許可済みmetadataだけを返す", async () => {
    const createSession = vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user" },
    });
    const findEntry = vi
      .fn()
      .mockResolvedValue({ vectorId: "private-vector-id", itemRevision: 12 });
    const getByIds = vi.fn().mockResolvedValue([
      {
        id: "private-vector-id",
        values: [0.1, 0.2, 0.3],
        metadata: {
          owner_scope: "private-owner-scope",
          category: "memory",
          derivation: "ai",
          embedding_version: 1,
          schema_version: 1,
        },
      },
    ]);
    const now = vi.fn(() => new Date("2026-08-10T00:00:00Z"));

    await expect(
      getDevelopmentBrainVector(
        {
          idToken: "token",
          lineLoginChannelId: "channel",
          db,
          accountData,
          vectorIndex,
          brainItemId: "brain-1",
        },
        { createSession, findEntry, getByIds, now },
      ),
    ).resolves.toEqual({
      type: "resolved",
      result: {
        state: "present",
        entryRevision: 12,
        dimensions: 3,
        metadata: {
          category: "memory",
          derivation: "ai",
          embeddingVersion: 1,
          schemaVersion: 1,
        },
        checkedAt: new Date("2026-08-10T00:00:00Z"),
      },
    });
    expect(findEntry).toHaveBeenCalledWith(accountData, "account-1", "brain-1");
    expect(getByIds).toHaveBeenCalledWith(vectorIndex, ["private-vector-id"]);
  });

  it("対応表がなければVectorizeを呼ばず未同期を返す", async () => {
    const getByIds = vi.fn();
    await expect(
      getDevelopmentBrainVector(
        {
          idToken: "token",
          lineLoginChannelId: "channel",
          db,
          accountData,
          vectorIndex,
          brainItemId: "brain-1",
        },
        {
          createSession: vi.fn().mockResolvedValue({
            type: "resolved",
            session: { accountId: "account-1", role: "user" },
          }),
          findEntry: vi.fn().mockResolvedValue(undefined),
          getByIds,
          now: () => new Date("2026-08-10T00:00:00Z"),
        },
      ),
    ).resolves.toEqual({
      type: "resolved",
      result: { state: "not-synced", checkedAt: new Date("2026-08-10T00:00:00Z") },
    });
    expect(getByIds).not.toHaveBeenCalled();
  });
});
