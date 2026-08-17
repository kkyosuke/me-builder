// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompatibilityInvitation } from "../../infrastructure/compatibility-api";
import { fetchCompatibilityAvatarImage } from "../../infrastructure/compatibility-avatar-api";
import { useCompatibilityInvitationPreview } from "./use-compatibility-invitation-preview";

vi.mock("../../infrastructure/compatibility-api", () => ({
  fetchCompatibilityInvitation: vi.fn(),
}));
vi.mock("../../infrastructure/compatibility-avatar-api", () => ({
  fetchCompatibilityAvatarImage: vi.fn(),
}));

const relationshipId = "1".repeat(64);
const invitation = {
  relationshipCategory: "friend" as const,
  inviter: {
    displayName: "あおい",
    avatarUrl: `/api/compatibility/invitations/${relationshipId}/avatar`,
  },
  recipient: { displayName: "はる", avatarUrl: null },
  expiresAt: "2026-08-26T00:00:00.000Z",
  canAccept: true,
  blockingReasons: [],
  nextAction: "diagnosis" as const,
};

describe("useCompatibilityInvitationPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCompatibilityAvatarImage)
      .mockResolvedValueOnce(new Blob([Uint8Array.from([1])]))
      .mockResolvedValueOnce(null);
    URL.createObjectURL = vi.fn().mockReturnValue("blob:inviter-avatar");
    URL.revokeObjectURL = vi.fn();
  });

  it("アプリセッションと関係IDで招待内容を取得する", async () => {
    vi.mocked(fetchCompatibilityInvitation).mockResolvedValue(invitation);
    const { result, unmount } = renderHook(() =>
      useCompatibilityInvitationPreview({ relationshipId }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(result.current.state).toEqual({
      status: "success",
      data: {
        ...invitation,
        inviter: { ...invitation.inviter, avatarUrl: "blob:inviter-avatar" },
        recipient: { ...invitation.recipient, avatarUrl: null },
      },
    });
    expect(fetchCompatibilityInvitation).toHaveBeenCalledWith(
      undefined,
      relationshipId,
      expect.anything(),
    );
    expect(fetchCompatibilityAvatarImage).toHaveBeenCalledTimes(2);

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:inviter-avatar");
  });

  it("関係IDを取り出せなければAPIを呼ばずエラーにする", async () => {
    const { result } = renderHook(() =>
      useCompatibilityInvitationPreview({ relationshipId: null }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({
      status: "error",
      message: "この招待リンクは利用できません。",
    });
    expect(fetchCompatibilityInvitation).not.toHaveBeenCalled();
  });
});
