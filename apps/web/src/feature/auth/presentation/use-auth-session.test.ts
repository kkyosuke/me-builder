// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_CHANGE_STORAGE_KEY,
  authSessionRuntime,
} from "../infrastructure/auth-session-runtime";
import { useAuthSessionState } from "./use-auth-session";

const mocks = vi.hoisted(() => ({
  config: {
    apiUrl: "https://api.example.com",
    liffId: "test-liff-id",
    ssoRolloutMode: "disabled" as "disabled" | "linking" | "linked-login",
  },
  fetchAuthSession: vi.fn(),
  detectAuthEntryEnvironment: vi.fn(),
  establishLiffAuthSession: vi.fn(),
  establishSsoAuthSession: vi.fn(),
  consumeSsoCallbackFailure: vi.fn(),
}));

vi.mock("../../../config", () => ({
  config: mocks.config,
}));
vi.mock("../../../infrastructure/requested-pathname", () => ({
  resolveRequestedLocation: () => "/diagnoses/diagnosis-1?from=notification#result",
}));
vi.mock("../infrastructure/auth-session-api", () => ({
  fetchAuthSession: mocks.fetchAuthSession,
}));
vi.mock("../infrastructure/liff-auth-adapter", () => ({
  detectAuthEntryEnvironment: mocks.detectAuthEntryEnvironment,
  establishLiffAuthSession: mocks.establishLiffAuthSession,
}));
vi.mock("../infrastructure/sso-auth-adapter", () => ({
  establishSsoAuthSession: mocks.establishSsoAuthSession,
  consumeSsoCallbackFailure: mocks.consumeSsoCallbackFailure,
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
    mocks.config.ssoRolloutMode = "disabled";
    mocks.consumeSsoCallbackFailure.mockReturnValue(undefined);
    mocks.detectAuthEntryEnvironment.mockResolvedValue({
      kind: "external",
      state: { status: "ready", inClient: false },
    });
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

  it("Strict Modeでもsession確認を多重実行しない", async () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(StrictMode, null, children);
    const { result } = renderHook(() => useAuthSessionState(), { wrapper });

    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    expect(mocks.fetchAuthSession).toHaveBeenCalledTimes(1);
  });

  it("sessionがなければLIFF credentialをapplication sessionへ交換する", async () => {
    mocks.fetchAuthSession.mockResolvedValue({ authenticated: false });
    mocks.establishLiffAuthSession.mockResolvedValue(authenticated);
    const { result } = renderHook(() => useAuthSessionState());

    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    expect(mocks.establishLiffAuthSession).toHaveBeenCalledWith(
      "https://api.example.com",
      "test-liff-id",
      expect.any(AbortSignal),
      expect.objectContaining({ status: "ready", inClient: false }),
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

  it("LIFF内は既存SSO sessionがあってもLIFF Identityを交換する", async () => {
    mocks.detectAuthEntryEnvironment.mockResolvedValue({
      kind: "liff",
      state: { status: "ready", inClient: true },
    });
    mocks.establishLiffAuthSession.mockResolvedValue(authenticated);

    const { result } = renderHook(() => useAuthSessionState());

    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    expect(mocks.fetchAuthSession).not.toHaveBeenCalled();
    expect(mocks.establishLiffAuthSession).toHaveBeenCalledWith(
      "https://api.example.com",
      "test-liff-id",
      expect.any(AbortSignal),
      expect.objectContaining({ inClient: true }),
    );
  });

  it("外部ブラウザはlinked-login公開時にLINE Loginを呼ばずSSOへ遷移する", async () => {
    mocks.config.ssoRolloutMode = "linked-login";
    mocks.fetchAuthSession.mockResolvedValue({ authenticated: false });
    mocks.establishSsoAuthSession.mockReturnValue({ redirecting: true });

    const { result } = renderHook(() => useAuthSessionState());

    await waitFor(() => expect(result.current.state.status).toBe("redirecting"));
    expect(mocks.establishSsoAuthSession).toHaveBeenCalledWith(
      "https://api.example.com",
      "/diagnoses/diagnosis-1?from=notification#result",
      expect.any(AbortSignal),
    );
    expect(mocks.establishLiffAuthSession).not.toHaveBeenCalled();
  });

  it.each([
    ["cancelled", "キャンセル"],
    ["error", "完了できません"],
  ] as const)(
    "SSO callbackの%s後は自動再開せず再試行可能なerrorを返す",
    async (result, message) => {
      mocks.config.ssoRolloutMode = "linked-login";
      mocks.fetchAuthSession.mockResolvedValue({ authenticated: false });
      mocks.consumeSsoCallbackFailure.mockReturnValue(result);

      const { result: hook } = renderHook(() => useAuthSessionState());

      await waitFor(() => expect(hook.current.state.status).toBe("error"));
      expect(hook.current.state).toMatchObject({ message: expect.stringContaining(message) });
      expect(mocks.establishSsoAuthSession).not.toHaveBeenCalled();
      expect(mocks.establishLiffAuthSession).not.toHaveBeenCalled();
    },
  );

  it("LIFF初期化失敗時はSSOへ自動fallbackせず外部ブラウザ案内を返す", async () => {
    mocks.config.ssoRolloutMode = "linked-login";
    mocks.detectAuthEntryEnvironment.mockResolvedValue({
      kind: "error",
      message: "LIFF initialization failed",
    });

    const { result } = renderHook(() => useAuthSessionState());

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toMatchObject({
      message: expect.stringContaining("外部ブラウザ"),
    });
    expect(mocks.establishSsoAuthSession).not.toHaveBeenCalled();
    expect(mocks.establishLiffAuthSession).not.toHaveBeenCalled();
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
    await waitFor(() => expect(resolveSession).toBeDefined());
    act(() => resolveSession?.(authenticated));
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

  it("別タブのLIFF交換通知ではLIFF交換を再実行せずsessionだけを再確認する", async () => {
    mocks.detectAuthEntryEnvironment.mockResolvedValue({
      kind: "liff",
      state: { status: "ready", inClient: true },
    });
    mocks.establishLiffAuthSession.mockResolvedValue(authenticated);
    const notify = vi.spyOn(authSessionRuntime, "notifyExternalSessionChange");
    const { result } = renderHook(() => useAuthSessionState());
    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    expect(result.current.state).toMatchObject({
      profile: { displayName: "うさぎ" },
      revision: 1,
    });
    expect(mocks.establishLiffAuthSession).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    mocks.establishLiffAuthSession.mockClear();
    notify.mockClear();
    mocks.fetchAuthSession.mockResolvedValueOnce({
      ...authenticated,
      displayProfile: { displayName: "別Account" },
      csrfToken: "csrf-token-b",
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: AUTH_SESSION_CHANGE_STORAGE_KEY, newValue: "opaque" }),
      );
    });

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        profile: { displayName: "別Account" },
        revision: 2,
      }),
    );
    expect(authSessionRuntime.csrfToken()).toBe("csrf-token-b");
    expect(mocks.fetchAuthSession).toHaveBeenCalledTimes(1);
    expect(mocks.establishLiffAuthSession).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    notify.mockRestore();
  });

  it("LIFF交換中に別タブ通知を受けても古い交換結果を表示せずsessionを再確認する", async () => {
    mocks.detectAuthEntryEnvironment.mockResolvedValue({
      kind: "liff",
      state: { status: "ready", inClient: true },
    });
    let resolveExchange: ((value: typeof authenticated) => void) | undefined;
    mocks.establishLiffAuthSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExchange = resolve;
        }),
    );
    mocks.fetchAuthSession.mockResolvedValueOnce({
      ...authenticated,
      displayProfile: { displayName: "切替後Account" },
      csrfToken: "csrf-token-after-switch",
    });
    const notify = vi.spyOn(authSessionRuntime, "notifyExternalSessionChange");
    const { result } = renderHook(() => useAuthSessionState());
    await waitFor(() => expect(resolveExchange).toBeDefined());

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: AUTH_SESSION_CHANGE_STORAGE_KEY, newValue: "opaque" }),
      );
    });
    act(() => resolveExchange?.(authenticated));

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: "authenticated",
        profile: { displayName: "切替後Account" },
        revision: 1,
      }),
    );
    expect(authSessionRuntime.csrfToken()).toBe("csrf-token-after-switch");
    expect(mocks.fetchAuthSession).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    notify.mockRestore();
  });

  it("session失効操作後は他タブへ通知して現在タブを既存sessionだけで未認証化する", async () => {
    const { result } = renderHook(() => useAuthSessionState());
    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    mocks.fetchAuthSession.mockResolvedValueOnce({
      authenticated: false,
      reason: "session-expired",
    });
    const notify = vi.spyOn(authSessionRuntime, "notifyExternalSessionChange");

    await act(async () => authSessionRuntime.synchronizeAfterSessionChange());

    expect(result.current.state).toEqual({
      status: "unauthenticated",
      reason: "session-expired",
    });
    expect(authSessionRuntime.csrfToken()).toBeNull();
    expect(mocks.fetchAuthSession).toHaveBeenCalledTimes(2);
    expect(mocks.establishLiffAuthSession).not.toHaveBeenCalled();
    expect(mocks.establishSsoAuthSession).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    notify.mockRestore();
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

  it("unmount時に進行中の確認をAbortする", async () => {
    let observedSignal: AbortSignal | undefined;
    mocks.fetchAuthSession.mockImplementation((_url: string, signal: AbortSignal) => {
      observedSignal = signal;
      return new Promise(() => undefined);
    });
    const { unmount } = renderHook(() => useAuthSessionState());
    await waitFor(() => expect(observedSignal).toBeDefined());

    unmount();

    expect(observedSignal?.aborted).toBe(true);
  });
});
