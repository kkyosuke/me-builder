// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompatibilityInvitation } from "../../infrastructure/compatibility-api";
import { useCompatibilityInvitationPreview } from "./use-compatibility-invitation-preview";

vi.mock("../../infrastructure/compatibility-api", () => ({
  fetchCompatibilityInvitation: vi.fn(),
}));

const relationshipId = "1".repeat(64);
const invitation = {
  inviter: {
    displayName: "あおい",
    avatarUrl: "https://profile.line-scdn.net/inviter",
    aboutMe: {
      profileSummaryVersionId: "profile-inviter",
      generatedAt: "2026-08-11T00:00:00.000Z",
      statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
    },
    themes: [],
  },
  recipient: {
    displayName: "はる",
    avatarUrl: null,
    previewToken: `csp2.${"a".repeat(64)}`,
    aboutMe: null,
    themes: [],
  },
  expiresAt: "2026-08-26T00:00:00.000Z",
  canAccept: false,
  blockingReasons: ["common_diagnosis_required" as const],
  nextAction: "diagnosis" as const,
};

describe("useCompatibilityInvitationPreview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("LIFFトークンと関係IDで招待内容を取得する", async () => {
    vi.mocked(fetchCompatibilityInvitation).mockResolvedValue(invitation);
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");
    const { result } = renderHook(() =>
      useCompatibilityInvitationPreview({ acquireIdToken, relationshipId }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(result.current.state).toEqual({ status: "success", data: invitation });
    expect(fetchCompatibilityInvitation).toHaveBeenCalledWith(
      undefined,
      "id-token",
      relationshipId,
      expect.anything(),
    );
  });

  it("関係IDを取り出せなければAPIを呼ばずエラーにする", async () => {
    const acquireIdToken = vi.fn();
    const { result } = renderHook(() =>
      useCompatibilityInvitationPreview({ acquireIdToken, relationshipId: null }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({
      status: "error",
      message: "この招待リンクは利用できません。",
    });
    expect(acquireIdToken).not.toHaveBeenCalled();
    expect(fetchCompatibilityInvitation).not.toHaveBeenCalled();
  });
});
