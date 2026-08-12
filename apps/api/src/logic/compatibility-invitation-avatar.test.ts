import type { R2Bucket } from "@cloudflare/workers-types";
import type { CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getCompatibilityInvitationAvatar } from "./compatibility-invitation-avatar";

const relationshipId = "a".repeat(64);
const db = {} as D1.shared.Client;
const params = {
  relationshipId,
  idToken: "id-token",
  lineLoginChannelId: "channel-id",
  db,
  avatarBucket: {} as R2Bucket,
  lineChannelAccessToken: "line-token",
  compatibilityData: {} as CompatibilityDataNamespace,
};

function dependencies() {
  return {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-recipient", role: "user", displayName: "はる" },
    }),
    getInvitationPreview: vi.fn().mockResolvedValue({
      inviterDisplayName: "あおい",
      expiresAt: new Date("2026-08-26T00:00:00.000Z"),
      isOwnInvitation: false,
    }),
    getInvitationContext: vi.fn().mockResolvedValue({ inviterAccountId: "account-inviter" }),
    resolveAvatarImage: vi.fn().mockResolvedValue({
      bytes: Uint8Array.from([1, 2, 3]),
      contentType: "image/png",
    }),
  };
}

describe("getCompatibilityInvitationAvatar", () => {
  it("認可済み招待contextの送信者Accountだけを画像解決へ渡す", async () => {
    const deps = dependencies();

    await expect(getCompatibilityInvitationAvatar(params, deps as never)).resolves.toMatchObject({
      type: "resolved",
      image: { contentType: "image/png" },
    });
    expect(deps.getInvitationPreview).toHaveBeenCalledWith(
      params.compatibilityData,
      relationshipId,
      "account-recipient",
    );
    expect(deps.resolveAvatarImage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "account-inviter" }),
    );
  });

  it("送信者本人と無効な招待には画像を返さない", async () => {
    const ownDeps = dependencies();
    ownDeps.getInvitationPreview.mockResolvedValue({ isOwnInvitation: true });
    await expect(getCompatibilityInvitationAvatar(params, ownDeps as never)).resolves.toEqual({
      type: "own-invitation",
    });
    expect(ownDeps.resolveAvatarImage).not.toHaveBeenCalled();

    const unavailableDeps = dependencies();
    unavailableDeps.getInvitationPreview.mockResolvedValue(null);
    await expect(
      getCompatibilityInvitationAvatar(params, unavailableDeps as never),
    ).resolves.toEqual({ type: "unavailable" });
    expect(unavailableDeps.getInvitationContext).not.toHaveBeenCalled();
  });
});
