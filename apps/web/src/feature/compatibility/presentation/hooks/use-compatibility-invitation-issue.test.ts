// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { issueCompatibilityInvitation } from "../../infrastructure/compatibility-api";
import { useCompatibilityInvitationIssue } from "./use-compatibility-invitation-issue";

vi.mock("../../infrastructure/compatibility-api", () => ({
  issueCompatibilityInvitation: vi.fn(),
}));

describe("useCompatibilityInvitationIssue", () => {
  it("クリック時にアプリセッションで招待を発行する", async () => {
    const invitation = {
      invitationUrl: `https://example.com/compatibility/invitations/${"1".repeat(64)}`,
      expiresAt: "2026-08-26T00:00:00.000Z",
      relationshipCategory: "family" as const,
    };
    vi.mocked(issueCompatibilityInvitation).mockResolvedValue(invitation);
    const { result } = renderHook(() => useCompatibilityInvitationIssue());

    act(() => void result.current.issue("family"));

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "success", data: invitation }),
    );
    expect(issueCompatibilityInvitation).toHaveBeenCalledWith(
      undefined,
      "family",
      expect.any(AbortSignal),
    );
  });
});
