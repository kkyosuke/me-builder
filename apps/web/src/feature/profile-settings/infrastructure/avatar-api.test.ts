// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAvatar, fetchAvatarImage, fetchAvatarState, saveAvatar } from "./avatar-api";

const avatarId = "00000000-0000-4000-8000-000000000002";
const state = {
  currentAvatar: { id: avatarId, imageUrl: `/api/avatar/images/${avatarId}` },
};

afterEach(() => vi.unstubAllGlobals());

describe("avatar-api", () => {
  it("認証付きで現在値を取得する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(state), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAvatarState("https://api.example.com", "id-token")).resolves.toEqual(state);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/avatar",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("画像だけをmultipartでPOSTして直接保存する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(state), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["selfie"], "selfie.png", { type: "image/png" });

    await saveAvatar("https://api.example.com", "id-token", file);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/avatar");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer id-token" });
    expect((init.body as FormData).get("image")).toBe(file);
    expect((init.body as FormData).has("consent")).toBe(false);
  });

  it("private画像を認証付きBlobとして取得する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["image"], { type: "image/webp" }), {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAvatarImage("https://api.example.com", "id-token", `/api/avatar/images/${avatarId}`),
    ).resolves.toMatchObject({ type: "image/webp" });
  });

  it("変更間隔の制限を次回変更日時つきで案内する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Avatar change rate limited",
            retryAt: "2026-08-16T00:00:00.000Z",
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(deleteAvatar("https://api.example.com", "id-token")).rejects.toEqual(
      expect.objectContaining({
        status: 429,
        message: expect.stringMatching(/アバターは7日間に1回変更できます。次回は.+以降/),
      }),
    );
  });
});
