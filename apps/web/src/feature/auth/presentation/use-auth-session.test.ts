// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authSessionRuntime } from "../infrastructure/auth-session-runtime";
import { useAuthSessionState } from "./use-auth-session";

const mocks = vi.hoisted(() => ({
  acquireIdToken: vi.fn(),
  fetchAuthSession: vi.fn(),
  establishLiffAuthSession: vi.fn(),
}));

vi.mock("../../../config", () => ({ config: { apiUrl: "https://api.example.com" } }));
vi.mock("../../liff", () => ({
  useLiffSession: () => ({ acquireIdToken: mocks.acquireIdToken, profile: null }),
}));
vi.mock("../infrastructure/auth-session-api", () => ({
  fetchAuthSession: mocks.fetchAuthSession,
}));
vi.mock("../infrastructure/liff-auth-adapter", () => ({
  establishLiffAuthSession: mocks.establishLiffAuthSession,
}));

const authenticated = {
  authenticated: true,
  displayProfile: { displayName: "うさぎ" },
  role: "user",
  csrfToken: "csrf-token",
} as const;

describe("useAuthSessionState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authSessionRuntime.reset();
    mocks.fetchAuthSession.mockResolvedValue(authenticated);
  });

  it("既存sessionを確認してprovider非依存の認証状態を公開する", async () => {
    const { result } = renderHook(() => useAuthSessionState());

    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    expect(result.current.state).toMatchObject({
      profile: { displayName: "うさぎ" },
      role: "user",
    });
    expect(authSessionRuntime.csrfToken()).toBe("csrf-token");
    expect(mocks.establishLiffAuthSession).not.toHaveBeenCalled();
  });

  it("sessionがなければLIFF credentialをapplication sessionへ交換する", async () => {
    mocks.fetchAuthSession.mockResolvedValue({ authenticated: false });
    mocks.establishLiffAuthSession.mockResolvedValue(authenticated);
    const { result } = renderHook(() => useAuthSessionState());

    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    expect(mocks.establishLiffAuthSession).toHaveBeenCalledWith(
      "https://api.example.com",
      mocks.acquireIdToken,
      expect.any(AbortSignal),
    );
  });

  it("表示プロフィールがないsessionは空の表示情報として公開する", async () => {
    mocks.fetchAuthSession.mockResolvedValue({
      authenticated: true,
      role: "user",
      csrfToken: "csrf-token",
    });
    const { result } = renderHook(() => useAuthSessionState());

    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    expect(result.current.state).toMatchObject({ profile: {} });
  });

  it("LIFFログイン遷移中はfeature requestを始められる状態にしない", async () => {
    mocks.fetchAuthSession.mockResolvedValue({ authenticated: false });
    mocks.establishLiffAuthSession.mockResolvedValue({ redirecting: true });
    const { result } = renderHook(() => useAuthSessionState());

    await waitFor(() => expect(result.current.state.status).toBe("redirecting"));
  });

  it("失敗後の再試行を同時に呼んでもsession確認を共有する", async () => {
    mocks.fetchAuthSession.mockRejectedValueOnce(new Error("network error"));
    const { result } = renderHook(() => useAuthSessionState());
    await waitFor(() => expect(result.current.state.status).toBe("error"));

    let resolveSession: ((value: typeof authenticated) => void) | undefined;
    mocks.fetchAuthSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
    );
    let retries: Promise<unknown>[] = [];
    act(() => {
      retries = [result.current.retry(), result.current.retry()];
    });
    resolveSession?.(authenticated);
    await act(async () => Promise.all(retries));

    expect(mocks.fetchAuthSession).toHaveBeenCalledTimes(2);
    expect(result.current.state.status).toBe("authenticated");
  });

  it("再確認失敗時は以前のCSRF tokenを破棄する", async () => {
    const { result } = renderHook(() => useAuthSessionState());
    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    mocks.fetchAuthSession.mockRejectedValueOnce(new Error("network error"));

    await act(async () => result.current.retry());

    expect(result.current.state.status).toBe("error");
    expect(authSessionRuntime.csrfToken()).toBeNull();
  });

  it("feature requestのAbortでは再確認を止めず、unmount時に止める", async () => {
    const { result, unmount } = renderHook(() => useAuthSessionState());
    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    let recheckSignal: AbortSignal | undefined;
    mocks.fetchAuthSession.mockImplementationOnce(
      (_url: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          recheckSignal = signal;
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const featureController = new AbortController();

    const recheck = authSessionRuntime.recheck(featureController.signal);
    await waitFor(() => expect(recheckSignal).toBeDefined());
    featureController.abort();
    await recheck;
    expect(recheckSignal?.aborted).toBe(false);

    unmount();
    expect(recheckSignal?.aborted).toBe(true);
  });

  it("unmount時に進行中の確認をAbortする", () => {
    let observedSignal: AbortSignal | undefined;
    mocks.fetchAuthSession.mockImplementation((_url: string, signal: AbortSignal) => {
      observedSignal = signal;
      return new Promise(() => undefined);
    });
    const { unmount } = renderHook(() => useAuthSessionState());

    unmount();

    expect(observedSignal?.aborted).toBe(true);
  });
});
