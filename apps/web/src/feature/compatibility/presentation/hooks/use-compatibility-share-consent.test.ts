// @vitest-environment jsdom

import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompatibilityShareConsent } from "../../infrastructure/compatibility-api";
import { fetchCompatibilityAvatarImage } from "../../infrastructure/compatibility-avatar-api";
import { useCompatibilityShareConsent } from "./use-compatibility-share-consent";

vi.mock("../../infrastructure/compatibility-api", () => ({
  fetchCompatibilityShareConsent: vi.fn(),
}));
vi.mock("../../infrastructure/compatibility-avatar-api", () => ({
  fetchCompatibilityAvatarImage: vi.fn(),
}));

const consent = {
  displayName: "うさぎ",
  avatarUrl: null,
  canShare: true,
  blockingReasons: [],
  nextAction: "diagnosis" as const,
};

describe("useCompatibilityShareConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCompatibilityAvatarImage).mockResolvedValue(null);
  });

  it("LIFFトークンで共有可否を取得する", async () => {
    vi.mocked(fetchCompatibilityShareConsent).mockResolvedValue(consent);
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");
    const { result } = renderHook(() =>
      useCompatibilityShareConsent({ acquireIdToken, relationshipCategory: null }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(result.current.state).toEqual({ status: "success", data: consent });
    expect(fetchCompatibilityShareConsent).toHaveBeenCalledWith(
      undefined,
      "id-token",
      undefined,
      expect.anything(),
    );
  });

  it("カテゴリ変更時は案内だけを再取得し、プロフィール画像を再取得しない", async () => {
    const consentWithAvatar = { ...consent, avatarUrl: "/api/profile/avatar" };
    vi.mocked(fetchCompatibilityShareConsent)
      .mockResolvedValueOnce(consentWithAvatar)
      .mockResolvedValueOnce({ ...consentWithAvatar, nextAction: "profile-summary" });
    vi.mocked(fetchCompatibilityAvatarImage).mockResolvedValue(
      new Blob(["avatar"], { type: "image/png" }),
    );
    URL.createObjectURL = vi.fn().mockReturnValue("blob:profile-avatar");
    URL.revokeObjectURL = vi.fn();
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");
    const { result, rerender } = renderHook(
      ({ category }: { category: CompatibilityRelationshipCategory | null }) =>
        useCompatibilityShareConsent({ acquireIdToken, relationshipCategory: category }),
      {
        initialProps: {
          category: null as CompatibilityRelationshipCategory | null,
        },
      },
    );

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    rerender({ category: "family" });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "success",
        data: {
          ...consentWithAvatar,
          avatarUrl: "blob:profile-avatar",
          nextAction: "profile-summary",
        },
      }),
    );

    expect(fetchCompatibilityShareConsent).toHaveBeenLastCalledWith(
      undefined,
      "id-token",
      "family",
      expect.anything(),
    );
    expect(fetchCompatibilityAvatarImage).toHaveBeenCalledTimes(1);
  });

  it("LIFFトークンを取得できなければ案内を表示する", async () => {
    const acquireIdToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() =>
      useCompatibilityShareConsent({ acquireIdToken, relationshipCategory: null }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({
      status: "error",
      message: "LINEから相性共有画面を開いてください。",
    });
  });
});
