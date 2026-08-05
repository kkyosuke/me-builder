// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLiffSession } from "./use-liff-session";

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

describe("useLiffSession", () => {
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
    const { result } = renderHook(() => useLiffSession());

    await expect(result.current.acquireIdToken(new AbortController().signal)).resolves.toBe(
      "dummy.id.token",
    );
    expect(mocks.initializeLiff).toHaveBeenCalledWith("test-liff-id");
  });

  it("ログイン遷移中はAPI取得を続行しない", async () => {
    mocks.initializeLiff.mockResolvedValue({ status: "login-required" });
    const { result } = renderHook(() => useLiffSession());

    await expect(result.current.acquireIdToken(new AbortController().signal)).resolves.toBeNull();
    expect(mocks.getLiffIdToken).not.toHaveBeenCalled();
  });

  it("IDトークンを取得できなければ表示可能なエラーにする", async () => {
    mocks.getLiffIdToken.mockReturnValue(null);
    const { result } = renderHook(() => useLiffSession());

    await expect(result.current.acquireIdToken(new AbortController().signal)).rejects.toThrow(
      "IDトークンを取得できませんでした",
    );
  });
});
