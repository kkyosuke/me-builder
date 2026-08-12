// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchCompatibilitySharePreview } from "../../infrastructure/compatibility-api";
import { useCompatibilitySharePreview } from "./use-compatibility-share-preview";

vi.mock("../../infrastructure/compatibility-api", () => ({
  fetchCompatibilitySharePreview: vi.fn(),
}));

const preview = {
  displayName: "うさぎ",
  avatarUrl: null,
  previewToken: `csp2.${"a".repeat(64)}`,
  aboutMe: {
    profileSummaryVersionId: "summary-version-1",
    generatedAt: "2026-08-11T00:00:00.000Z",
    statements: [
      {
        key: "planning-style",
        label: "予定の立て方",
        statement: "私は、先の見通しを持って動けると安心しやすいです",
      },
    ],
  },
  themes: [],
  canIssueInvitation: false,
  blockingReasons: ["diagnosis_required" as const],
  nextAction: "diagnosis" as const,
};

describe("useCompatibilitySharePreview", () => {
  it("LIFFトークンで共有プレビューを取得する", async () => {
    vi.mocked(fetchCompatibilitySharePreview).mockResolvedValue(preview);
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");
    const { result } = renderHook(() => useCompatibilitySharePreview({ acquireIdToken }));

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(result.current.state).toEqual({ status: "success", data: preview });
    expect(fetchCompatibilitySharePreview).toHaveBeenCalledWith(
      undefined,
      "id-token",
      expect.anything(),
    );
  });

  it("LIFFトークンを取得できなければ案内を表示する", async () => {
    const acquireIdToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useCompatibilitySharePreview({ acquireIdToken }));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({
      status: "error",
      message: "LINEから相性共有画面を開いてください。",
    });
  });
});
