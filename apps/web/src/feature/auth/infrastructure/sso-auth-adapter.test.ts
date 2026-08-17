// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  consumeSsoCallbackFailure,
  consumeSsoIdentityCallbackResult,
  establishSsoAuthSession,
  ssoLoginPath,
} from "./sso-auth-adapter";

describe("SSO auth adapter", () => {
  it("要求された相対pathをserver-side SSO開始endpointだけへ渡す", () => {
    expect(ssoLoginPath("/compatibility/invitations/abc")).toBe(
      "/api/auth/sso/login?returnTo=%2Fcompatibility%2Finvitations%2Fabc",
    );
  });

  it("同一browserからPOSTで開始して返された認可URLへだけ遷移する", async () => {
    const navigate = vi.fn();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ authorizationUrl: "https://tenant.auth0.com/authorize?state=opaque" }),
      );

    await expect(
      establishSsoAuthSession(
        "https://api.example.com",
        "/admin",
        new AbortController().signal,
        navigate,
      ),
    ).resolves.toEqual({ redirecting: true });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/sso/login?returnTo=%2Fadmin",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(navigate).toHaveBeenCalledWith("https://tenant.auth0.com/authorize?state=opaque");
  });

  it.each(["cancelled", "error"] as const)(
    "callbackの%s markerだけをURLから一度消費する",
    (result) => {
      window.history.replaceState({}, "", `/diagnosis/result?from=share&sso=${result}#answer`);

      expect(consumeSsoCallbackFailure()).toBe(result);
      expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
        "/diagnosis/result?from=share#answer",
      );
      expect(consumeSsoCallbackFailure()).toBeUndefined();
    },
  );

  it.each(["linked", "cancelled", "error"] as const)(
    "Identity連携callbackの%s markerを他のURL要素を保って一度だけ消費する",
    (result) => {
      window.history.replaceState({}, "", `/profile?from=settings&sso=${result}#login-method`);

      expect(consumeSsoIdentityCallbackResult()).toBe(result);
      expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
        "/profile?from=settings#login-method",
      );
      expect(consumeSsoIdentityCallbackResult()).toBeUndefined();
    },
  );
});
