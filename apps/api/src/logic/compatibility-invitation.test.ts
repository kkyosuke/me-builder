import type { AccountDataNamespace, CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { issueCompatibilityInvitation } from "./compatibility-invitation";

const relationshipId = "1".repeat(64);
const expiresAt = new Date("2026-08-26T00:00:00.000Z");
const db = {} as D1.shared.Client;
const accountData = {} as AccountDataNamespace;
const compatibilityData = {} as CompatibilityDataNamespace;

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
        idToken: "id-token",
        lineLoginChannelId: "channel-id",
        liffId: "1234567890-testliff",
        db,
        accountData,
        compatibilityData,
      },
      deps,
    );

    expect(result).toEqual({
      type: "created",
      invitationUrl: `https://liff.line.me/1234567890-testliff/compatibility/invitations/${relationshipId}`,
      expiresAt: expiresAt.toISOString(),
    });
    expect(deps.createInvitation).toHaveBeenCalledWith(accountData, compatibilityData, {
      inviterAccountId: "account-1",
      inviterDisplayName: "あおい",
    });
  });

  it("共有できる内容の有無を問わず、AccountDataを読まずに招待を作る", async () => {
    const deps = dependencies();

    await expect(
      issueCompatibilityInvitation(
        {
          idToken: "id-token",
          lineLoginChannelId: "channel-id",
          liffId: "1234567890-testliff",
          db,
          accountData,
          compatibilityData,
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
          idToken: "id-token",
          lineLoginChannelId: "channel-id",
          liffId: "1234567890-testliff",
          db,
          accountData,
          compatibilityData,
        },
        deps,
      ),
    ).resolves.toEqual({ type: "share-unavailable" });
    expect(deps.createInvitation).not.toHaveBeenCalled();
  });
});
