import { describe, expect, it, vi } from "vitest";
import { establishSsoAuthSession, ssoLoginUrl } from "./sso-auth-adapter";

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
});
