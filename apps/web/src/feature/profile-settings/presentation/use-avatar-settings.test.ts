// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAvatarSettings } from "./use-avatar-settings";

const mocks = vi.hoisted(() => ({
  fetchAvatarState: vi.fn(),
  fetchAvatarImage: vi.fn(),
  uploadAvatarSource: vi.fn(),
  selectAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}));

vi.mock("../infrastructure/avatar-api", () => mocks);

const timestamp = "2026-08-10T00:00:00.000Z";

function response(
  status: "checking" | "verified" | "ready",
  retryAfterMilliseconds: number | null = 10,
) {
  return {
    state: {
      currentAvatar: null,
      job: {
        id: "00000000-0000-4000-8000-000000000001",
        status,
        errorCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: timestamp,
        candidates: [],
      },
    },
    retryAfterMilliseconds,
  };
}

describe("useAvatarSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:avatar"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(cleanup);

  it("処理中はRetry-After相当の間隔で再取得し、完了状態で停止する", async () => {
    mocks.fetchAvatarState
      .mockResolvedValueOnce(response("checking"))
      .mockResolvedValueOnce(response("verified"))
      .mockResolvedValueOnce(response("ready", null));
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");

    const { result } = renderHook(() =>
      useAvatarSettings({ acquireIdToken, enabled: true, pollingEnabled: true }),
    );

    await waitFor(() => expect(result.current.job?.status).toBe("ready"));
    expect(mocks.fetchAvatarState).toHaveBeenCalledTimes(3);
    expect(acquireIdToken).toHaveBeenCalledTimes(3);
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 25)));
    expect(mocks.fetchAvatarState).toHaveBeenCalledTimes(3);
  });

  it("設定画面を開いていない間は処理中でもpollingしない", async () => {
    mocks.fetchAvatarState.mockResolvedValue(response("checking"));
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");

    renderHook(() =>
      useAvatarSettings({
        acquireIdToken,
        enabled: true,
        pollingEnabled: false,
      }),
    );

    await waitFor(() => expect(mocks.fetchAvatarState).toHaveBeenCalledOnce());
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 25)));
    expect(mocks.fetchAvatarState).toHaveBeenCalledOnce();
  });
});
