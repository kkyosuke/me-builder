// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { issueCompatibilityInvitation } from "../../infrastructure/compatibility-api";
import { useCompatibilityInvitationIssue } from "./use-compatibility-invitation-issue";

vi.mock("../../infrastructure/compatibility-api", () => ({
  issueCompatibilityInvitation: vi.fn(),
}));

describe("useCompatibilityInvitationIssue", () => {
  it("クリック時にLIFFトークンを取得して招待を発行する", async () => {
    const invitation = {
      invitationUrl: `https://example.com/compatibility/invitations/${"1".repeat(64)}`,
      expiresAt: "2026-08-26T00:00:00.000Z",
    };
    vi.mocked(issueCompatibilityInvitation).mockResolvedValue(invitation);
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");
    const { result } = renderHook(() => useCompatibilityInvitationIssue({ acquireIdToken }));
    const previewToken = `csp2.${"a".repeat(64)}`;

    act(() => void result.current.issue(previewToken));

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "success", data: invitation }),
    );
    expect(issueCompatibilityInvitation).toHaveBeenCalledWith(
      undefined,
      "id-token",
      previewToken,
      expect.any(AbortSignal),
    );
  });
});
