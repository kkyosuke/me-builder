// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAvatarSettings } from "./use-avatar-settings";

const mocks = vi.hoisted(() => ({
  fetchAvatarState: vi.fn(),
  fetchAvatarImage: vi.fn(),
  saveAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}));

vi.mock("../infrastructure/avatar-api", () => mocks);

const avatar = {
  id: "00000000-0000-4000-8000-000000000001",
  imageUrl: "/api/avatar/images/00000000-0000-4000-8000-000000000001",
};

describe("useAvatarSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAvatarState.mockResolvedValue({ currentAvatar: null });
    mocks.fetchAvatarImage.mockResolvedValue(new Blob(["image"], { type: "image/webp" }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:avatar"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(cleanup);

  it("初回に現在のアバターを取得する", async () => {
    mocks.fetchAvatarState.mockResolvedValue({ currentAvatar: avatar });
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");
    const { result } = renderHook(() => useAvatarSettings({ acquireIdToken, enabled: true }));

    await waitFor(() => expect(result.current.currentAvatar?.src).toBe("blob:avatar"));
    expect(mocks.fetchAvatarState).toHaveBeenCalledOnce();
    expect(mocks.fetchAvatarImage).toHaveBeenCalledWith(
      undefined,
      "id-token",
      avatar.imageUrl,
      expect.any(AbortSignal),
    );
  });

  it("保存結果を現在値へ即時反映する", async () => {
    mocks.saveAvatar.mockResolvedValue({ currentAvatar: avatar });
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");
    const { result } = renderHook(() => useAvatarSettings({ acquireIdToken, enabled: true }));
    await waitFor(() => expect(result.current.loadStatus).toBe("ready"));

    const file = new File(["image"], "avatar.png", { type: "image/png" });
    await act(async () => {
      await expect(result.current.save(file)).resolves.toBe(true);
    });
    await waitFor(() => expect(result.current.currentAvatar?.id).toBe(avatar.id));
  });
});
