import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { issueCompatibilityInvitation } from "./compatibility-invitation";

const relationshipId = "1".repeat(64);
const expiresAt = new Date("2026-08-26T00:00:00.000Z");
const accountData = {} as AccountDataNamespace;
const compatibilityData = {} as CompatibilityDataNamespace;
const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
};

function dependencies(overrides: Record<string, unknown> = {}) {
  const base = {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user", displayName: " あおい " },
    }),
    createInvitation: vi.fn().mockResolvedValue({
      outcome: "created",
      relationship: {
        id: relationshipId,
        expiresAt,
        relationshipCategory: "family",
      },
    }),
  };
  return { ...base, ...overrides } as typeof base;
}

describe("issueCompatibilityInvitation", () => {
  it("同意時点の表示名だけを固定して招待を作る", async () => {
    const deps = dependencies();
    const result = await issueCompatibilityInvitation(
      {
        actor,
        verifiedDisplayName: " あおい ",
        liffId: "1234567890-testliff",
        accountData,
        compatibilityData,
        relationshipCategory: "family",
      },
      deps,
    );

    expect(result).toEqual({
      type: "created",
      invitationUrl: `https://liff.line.me/1234567890-testliff/compatibility/invitations/${relationshipId}`,
      expiresAt: expiresAt.toISOString(),
      relationshipCategory: "family",
    });
    expect(deps.createInvitation).toHaveBeenCalledWith(accountData, compatibilityData, {
      inviterAccountId: "account-1",
      inviterDisplayName: "あおい",
      relationshipCategory: "family",
    });
  });

  it("共有できる内容の有無を問わず、AccountDataを読まずに招待を作る", async () => {
    const deps = dependencies();

    await expect(
      issueCompatibilityInvitation(
        {
          actor,
          verifiedDisplayName: " あおい ",
          liffId: "1234567890-testliff",
          accountData,
          compatibilityData,
          relationshipCategory: "friend",
        },
        deps,
      ),
    ).resolves.toMatchObject({ type: "created" });
    expect(deps.createInvitation).toHaveBeenCalledOnce();
  });

  it("相手へ表示する名前を確認できない場合は招待を作らない", async () => {
    const deps = dependencies({
      createSession: vi.fn().mockResolvedValue({
        type: "resolved",
        session: { accountId: "account-1", role: "user" },
      }),
    });

    await expect(
      issueCompatibilityInvitation(
        {
          actor,
          liffId: "1234567890-testliff",
          accountData,
          compatibilityData,
          relationshipCategory: "work",
        },
        deps,
      ),
    ).resolves.toEqual({ type: "share-unavailable" });
    expect(deps.createInvitation).not.toHaveBeenCalled();
  });
});
