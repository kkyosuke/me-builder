// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLiffSessionState } from "./use-liff-session";

const mocks = vi.hoisted(() => ({
  initializeLiff: vi.fn(),
  getLiffIdToken: vi.fn(),
}));

vi.mock("../../../../config", () => ({
  config: { liffId: "test-liff-id" },
}));
vi.mock("../../infrastructure/liff-client", () => ({
  initializeLiff: mocks.initializeLiff,
  getLiffIdToken: mocks.getLiffIdToken,
}));

describe("useLiffSessionState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initializeLiff.mockResolvedValue({
      status: "ready",
      inClient: true,
      profile: { displayName: "テスト" },
    });
    mocks.getLiffIdToken.mockReturnValue("dummy.id.token");
  });

  it("LIFF初期化後にIDトークンを返す", async () => {
    const { result } = renderHook(() => useLiffSessionState(false));

    await expect(result.current.acquireIdToken(new AbortController().signal)).resolves.toBe(
      "dummy.id.token",
    );
    expect(mocks.initializeLiff).toHaveBeenCalledWith("test-liff-id");
  });

  it("初期化時にLINEプロフィール画像を画面向けに公開する", async () => {
    mocks.initializeLiff.mockResolvedValue({
      status: "ready",
      inClient: true,
      profile: { displayName: "テスト", pictureUrl: "https://example.com/line-profile.jpg" },
    });

    const { result } = renderHook(() => useLiffSessionState());

    await waitFor(() => expect(result.current.isInitializing).toBe(false));
    expect(result.current.profile?.pictureUrl).toBe("https://example.com/line-profile.jpg");
  });

  it("同じ画面から同時に認証を要求してもLIFF初期化を共有する", async () => {
    let resolveInitialization: ((state: unknown) => void) | undefined;
    mocks.initializeLiff.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInitialization = resolve;
        }),
    );
    const { result } = renderHook(() => useLiffSessionState(false));

    const first = result.current.acquireIdToken(new AbortController().signal);
    const second = result.current.acquireIdToken(new AbortController().signal);
    expect(mocks.initializeLiff).toHaveBeenCalledTimes(1);

    resolveInitialization?.({
      status: "ready",
      inClient: true,
      profile: { displayName: "テスト" },
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      "dummy.id.token",
      "dummy.id.token",
    ]);
  });

  it("ログイン遷移中はAPI取得を続行しない", async () => {
    mocks.initializeLiff.mockResolvedValue({ status: "login-required" });
    const { result } = renderHook(() => useLiffSessionState(false));

    await expect(result.current.acquireIdToken(new AbortController().signal)).resolves.toBeNull();
    expect(mocks.getLiffIdToken).not.toHaveBeenCalled();
  });

  it("IDトークンを取得できなければ表示可能なエラーにする", async () => {
    mocks.getLiffIdToken.mockReturnValue(null);
    const { result } = renderHook(() => useLiffSessionState(false));

    await expect(result.current.acquireIdToken(new AbortController().signal)).rejects.toThrow(
      "IDトークンを取得できませんでした",
    );
  });
});
