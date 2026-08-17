import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCompatibilityAvatarImage } from "./compatibility-avatar-api";

describe("fetchCompatibilityAvatarImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("許可されたAPI pathへだけアプリセッション付きで画像を取得する", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(Uint8Array.from([1, 2, 3]), {
          headers: { "Content-Type": "image/png" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchCompatibilityAvatarImage("https://api.example.com", "/api/profile/avatar"),
    ).resolves.toMatchObject({ size: 3, type: "image/png" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/profile/avatar",
      expect.objectContaining({ credentials: "include" }),
    );

    const invitationAvatarPath = `/api/compatibility/invitations/${"a".repeat(64)}/avatar`;
    await expect(
      fetchCompatibilityAvatarImage("https://api.example.com", invitationAvatarPath),
    ).resolves.toMatchObject({ size: 3, type: "image/png" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://api.example.com${invitationAvatarPath}`,
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("外部URLへCookieを送らない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchCompatibilityAvatarImage("https://api.example.com", "https://attacker.example/avatar"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("不正な関係IDを含む内部pathへもCookieを送らない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchCompatibilityAvatarImage(
        "https://api.example.com",
        "/api/compatibility/invitations/invalid/avatar",
      ),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("画像なしと対応外Content-Typeはnullへ縮退する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(
      fetchCompatibilityAvatarImage(undefined, "/api/profile/avatar"),
    ).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
        ),
    );
    await expect(
      fetchCompatibilityAvatarImage(undefined, "/api/profile/avatar"),
    ).resolves.toBeNull();
  });
});
