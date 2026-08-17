import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeLiffCredential, fetchAuthSession } from "./auth-session-api";

describe("auth session API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cookieでsessionを確認し、表示可能な情報だけを返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        authenticated: true,
        displayProfile: { displayName: "うさぎ" },
        role: "user",
        csrfToken: "csrf-token",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAuthSession("https://api.example.com", new AbortController().signal),
    ).resolves.toMatchObject({
      authenticated: true,
      displayProfile: { displayName: "うさぎ" },
      role: "user",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/session",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("LIFF credentialをbodyで交換しURLやresponseへ残さない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        authenticated: true,
        role: "admin",
        csrfToken: "csrf-token",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeLiffCredential(
      "https://api.example.com",
      "secret.id.token",
      new AbortController().signal,
    );

    expect(result).toMatchObject({ authenticated: true, role: "admin" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).not.toContain("secret.id.token");
    expect(JSON.parse(String(init?.body))).toEqual({ idToken: "secret.id.token" });
  });

  it("displayProfileが省略されたsessionも受理する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          authenticated: true,
          role: "user",
          csrfToken: "csrf-token",
        }),
      ),
    );

    await expect(
      fetchAuthSession("https://api.example.com", new AbortController().signal),
    ).resolves.toEqual({ authenticated: true, role: "user", csrfToken: "csrf-token" });
  });

  it("401を期限切れsessionとして正規化する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    await expect(fetchAuthSession(undefined, new AbortController().signal)).resolves.toEqual({
      authenticated: false,
      reason: "session-expired",
    });
  });
});
