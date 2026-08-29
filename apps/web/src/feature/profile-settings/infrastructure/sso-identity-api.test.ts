import { afterEach, describe, expect, it, vi } from "vitest";
import { authSessionRuntime } from "../../../infrastructure/auth-session-runtime";
import {
  confirmSsoLinkAttempt,
  fetchSsoIdentityStatus,
  fetchSsoLinkAttemptStatus,
  startSsoIdentityLink,
  unlinkSsoIdentity,
} from "./sso-identity-api";

describe("sso identity api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    authSessionRuntime.setCsrfToken(null);
  });

  it("HttpOnly sessionでsubjectを含まない接続状態を取得する", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ linked: true, canUnlink: true }));

    await expect(fetchSsoIdentityStatus("https://api.example.com")).resolves.toEqual({
      linked: true,
      canUnlink: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/sso/identity",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("link開始をCSRF token付きPOSTで要求し、認可URLだけを受け取る", async () => {
    authSessionRuntime.setCsrfToken("csrf-token");
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        flow: "same-browser",
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque",
      }),
    );

    await expect(
      startSsoIdentityLink("https://api.example.com/", "/profile?sso=linking"),
    ).resolves.toEqual({
      flow: "same-browser",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/sso/link?returnTo=%2Fprofile%3Fsso%3Dlinking",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.any(Headers),
      }),
    );
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-token");
  });

  it("LIFF handoffの状態確認と確定に開始元だけの確認secretを付ける", async () => {
    authSessionRuntime.setCsrfToken("csrf-token");
    const synchronize = vi
      .spyOn(authSessionRuntime, "synchronizeAfterSessionChange")
      .mockResolvedValue();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ status: "ready" }))
      .mockResolvedValueOnce(Response.json({ linked: true, canUnlink: true }));

    await expect(
      fetchSsoLinkAttemptStatus("https://api.example.com", "attempt-1", "confirmation-secret"),
    ).resolves.toBe("ready");
    await expect(
      confirmSsoLinkAttempt("https://api.example.com", "attempt-1", "confirmation-secret"),
    ).resolves.toEqual({ linked: true, canUnlink: true });

    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("X-SSO-Link-Confirmation")).toBe(
      "confirmation-secret",
    );
    const confirmationHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(confirmationHeaders.get("X-SSO-Link-Confirmation")).toBe("confirmation-secret");
    expect(confirmationHeaders.get("X-CSRF-Token")).toBe("csrf-token");
    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("解除requestへapplication sessionのCSRF tokenを付ける", async () => {
    authSessionRuntime.setCsrfToken("csrf-token");
    const synchronize = vi
      .spyOn(authSessionRuntime, "synchronizeAfterSessionChange")
      .mockResolvedValue();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await unlinkSsoIdentity("https://api.example.com");

    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.method).toBe("DELETE");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(init?.credentials).toBe("include");
    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("最後のIdentity解除拒否を利用者向けerrorへ変換する", async () => {
    const synchronize = vi.spyOn(authSessionRuntime, "synchronizeAfterSessionChange");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    await expect(unlinkSsoIdentity("https://api.example.com")).rejects.toThrow(
      "最後のログイン方法",
    );
    expect(synchronize).not.toHaveBeenCalled();
  });
});
