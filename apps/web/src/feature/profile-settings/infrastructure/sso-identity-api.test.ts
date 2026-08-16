import { afterEach, describe, expect, it, vi } from "vitest";
import { authSessionRuntime } from "../../auth/infrastructure/auth-session-runtime";
import { fetchSsoIdentityStatus, ssoIdentityLinkUrl, unlinkSsoIdentity } from "./sso-identity-api";

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

  it("link開始URLには同一siteの相対returnToだけを渡す", () => {
    expect(ssoIdentityLinkUrl("https://api.example.com/", "/profile?sso=linking")).toBe(
      "https://api.example.com/api/auth/sso/link?returnTo=%2Fprofile%3Fsso%3Dlinking",
    );
  });

  it("解除requestへapplication sessionのCSRF tokenを付ける", async () => {
    authSessionRuntime.setCsrfToken("csrf-token");
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await unlinkSsoIdentity("https://api.example.com");

    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.method).toBe("DELETE");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(init?.credentials).toBe("include");
  });

  it("最後のIdentity解除拒否を利用者向けerrorへ変換する", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    await expect(unlinkSsoIdentity("https://api.example.com")).rejects.toThrow(
      "最後のログイン方法",
    );
  });
});
