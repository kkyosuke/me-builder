import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccountAvatar, fetchAccountProfile, saveAccountAvatar } from "./profile-api";

const fetchMock = vi.fn<typeof fetch>();

function profileResponse(
  avatar: { source: "uploaded" | "line"; url: string; updatedAt: string | null } | null,
) {
  return Response.json({ role: "user", displayName: "利用者", avatar });
}

describe("profile settings API", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("本人のプロフィールをAccount IDなしで取得する", async () => {
    fetchMock.mockResolvedValueOnce(
      profileResponse({
        source: "uploaded",
        url: "data:image/png;base64,AQID",
        updatedAt: "2026-08-11T00:00:00.000Z",
      }),
    );

    await expect(
      fetchAccountProfile("https://api.example.com/", "id-token"),
    ).resolves.toMatchObject({
      role: "user",
      avatar: { source: "uploaded", url: "data:image/png;base64,AQID" },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/profile", {
      headers: { Authorization: "Bearer id-token" },
    });
  });

  it("選択画像のbytesとContent-TypeをPUTする", async () => {
    fetchMock.mockResolvedValueOnce(
      profileResponse({
        source: "uploaded",
        url: "data:image/png;base64,AQID",
        updatedAt: "2026-08-11T00:00:00.000Z",
      }),
    );

    await saveAccountAvatar("https://api.example.com", "id-token", {
      kind: "uploaded",
      dataUrl: "data:image/png;base64,AQID",
      fileName: "表示しない.png",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.example.com/api/profile/avatar");
    expect(init).toMatchObject({
      method: "PUT",
      headers: { Authorization: "Bearer id-token", "Content-Type": "image/png" },
    });
    expect([...new Uint8Array(init?.body as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it("保存画像を削除してLINE画像へ戻す", async () => {
    fetchMock.mockResolvedValueOnce(
      profileResponse({
        source: "line",
        url: "https://profile.line-scdn.net/avatar",
        updatedAt: null,
      }),
    );

    await expect(deleteAccountAvatar("https://api.example.com", "id-token")).resolves.toMatchObject(
      { avatar: { source: "line" } },
    );
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/profile/avatar", {
      method: "DELETE",
      headers: { Authorization: "Bearer id-token" },
    });
  });

  it("画像拒否を選び直せるメッセージへ変換する", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "Unsupported avatar image" }, { status: 415 }),
    );

    await expect(
      saveAccountAvatar("https://api.example.com", "id-token", {
        kind: "uploaded",
        dataUrl: "data:image/png;base64,AQID",
        fileName: "broken.png",
      }),
    ).rejects.toThrow("別の画像を選んでください");
  });

  it("通信失敗を再試行できるメッセージへ変換する", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(fetchAccountProfile("https://api.example.com", "id-token")).rejects.toThrow(
      "プロフィールの取得に失敗しました。再試行してください。",
    );
  });
});
