import type { AccountDataNamespace, CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { acceptCompatibilityInvitationWithReferences, resolveCompatibilityInvitationRecipient } =
  vi.hoisted(() => ({
    acceptCompatibilityInvitationWithReferences: vi.fn(),
    resolveCompatibilityInvitationRecipient: vi.fn(),
  }));
vi.mock("@me-builder/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@me-builder/lib")>()),
  acceptCompatibilityInvitationWithReferences,
}));
vi.mock("./compatibility-invitation-preview", () => ({ resolveCompatibilityInvitationRecipient }));

const { acceptCompatibilityInvitation } = await import("./compatibility-invitation-acceptance");

const relationshipId = "1".repeat(64);
const inviteeAccountId = "account-invitee";
const db = {} as D1.shared.Client;
const accountData = {} as AccountDataNamespace;
const compatibilityData = {} as CompatibilityDataNamespace;

function recipient(overrides: { inviteeDisplayName?: string | null } = {}) {
  return {
    type: "resolved" as const,
    inviteeAccountId,
    inviteeDisplayName:
      overrides.inviteeDisplayName === undefined ? "はる" : overrides.inviteeDisplayName,
    inviterDisplayName: "あおい",
    expiresAt: new Date("2026-08-26T00:00:00.000Z"),
  };
}

function request() {
  return acceptCompatibilityInvitation({
    relationshipId,
    idToken: "token",
    lineLoginChannelId: "channel",
    db,
    accountData,
    compatibilityData,
  });
}

describe("acceptCompatibilityInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCompatibilityInvitationRecipient.mockResolvedValue(recipient());
    acceptCompatibilityInvitationWithReferences.mockResolvedValue({
      outcome: "accepted",
      relationship: { inviteeAccountId },
    });
  });

  it("継続同意として承諾し、固定するのは受信者の表示名だけにする", async () => {
    await expect(request()).resolves.toEqual({ type: "accepted", relationshipId });
    expect(acceptCompatibilityInvitationWithReferences).toHaveBeenCalledWith(
      accountData,
      compatibilityData,
      relationshipId,
      { inviteeAccountId, inviteeDisplayName: "はる" },
    );
  });

  it("同じ承諾の再試行も成立として返す", async () => {
    acceptCompatibilityInvitationWithReferences.mockResolvedValue({
      outcome: "unchanged",
      relationship: { inviteeAccountId },
    });

    await expect(request()).resolves.toEqual({ type: "accepted", relationshipId });
  });

  it("検証済み表示名を取得できなければ書き込まずshare-unavailableを返す", async () => {
    resolveCompatibilityInvitationRecipient.mockResolvedValue(
      recipient({ inviteeDisplayName: null }),
    );

    await expect(request()).resolves.toEqual({ type: "share-unavailable" });
    expect(acceptCompatibilityInvitationWithReferences).not.toHaveBeenCalled();
  });

  it("同じ2人の関係がすでにあればduplicate-relationshipを返す", async () => {
    acceptCompatibilityInvitationWithReferences.mockResolvedValue({ outcome: "duplicate" });

    await expect(request()).resolves.toEqual({ type: "duplicate-relationship" });
  });

  it("送信者本人の承諾はown-invitationを返す", async () => {
    acceptCompatibilityInvitationWithReferences.mockResolvedValue({ outcome: "self-invite" });

    await expect(request()).resolves.toEqual({ type: "own-invitation" });
  });

  it.each([["expired"], ["unavailable"], ["unreserved"]] as const)(
    "正本が%sなら理由を区別せずunavailableを返す",
    async (outcome) => {
      acceptCompatibilityInvitationWithReferences.mockResolvedValue({ outcome });

      await expect(request()).resolves.toEqual({ type: "unavailable" });
    },
  );

  it.each([
    [{ type: "unavailable" }],
    [{ type: "own-invitation" }],
    [{ type: "unauthenticated", reason: "invalid token" }],
    [{ type: "account-not-found" }],
    [{ type: "not-configured" }],
  ])("受信者を解決できなければそのまま返す (%o)", async (outcome) => {
    resolveCompatibilityInvitationRecipient.mockResolvedValue(outcome);

    await expect(request()).resolves.toEqual(outcome);
    expect(acceptCompatibilityInvitationWithReferences).not.toHaveBeenCalled();
  });
});
