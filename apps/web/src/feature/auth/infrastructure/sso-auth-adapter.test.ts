// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  consumeSsoCallbackFailure,
  consumeSsoIdentityCallbackResult,
  establishSsoAuthSession,
  ssoLoginUrl,
} from "./sso-auth-adapter";

describe("SSO auth adapter", () => {
  it("要求された相対pathをserver-side SSO開始endpointだけへ渡す", () => {
    expect(ssoLoginUrl("https://api.example.com/", "/compatibility/invitations/abc")).toBe(
      "https://api.example.com/api/auth/sso/login?returnTo=%2Fcompatibility%2Finvitations%2Fabc",
    );
  });

  it("外部ブラウザをSSOへ遷移しprovider credentialを扱わない", () => {
    const navigate = vi.fn();

    expect(
      establishSsoAuthSession(
        "https://api.example.com",
        "/admin",
        new AbortController().signal,
        navigate,
      ),
    ).toEqual({ redirecting: true });
    expect(navigate).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/sso/login?returnTo=%2Fadmin",
    );
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
