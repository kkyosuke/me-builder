import { afterEach, describe, expect, it, vi } from "vitest";
import { authSessionRuntime } from "../../../infrastructure/auth-session-runtime";
import { deletePhotoDiary, fetchPhotoDiaries, resolvePhotoDiaryImageUrl } from "./photo-diary-api";

describe("photo diary api", () => {
  afterEach(() => {
    authSessionRuntime.setCsrfToken(null);
    vi.restoreAllMocks();
  });

  it("本人sessionで写真一覧を取得し、private APIの画像URLを解決する", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        items: [
          {
            id: "0198d61d-0f4e-7af2-9be0-0d9576e6ba52",
            capturedAt: "2026-08-22T01:00:00.000Z",
            mimeType: "image/jpeg",
            byteSize: 1_024,
            width: 800,
            height: 600,
            thumbnailUrl: "/api/diary/photos/0198d61d-0f4e-7af2-9be0-0d9576e6ba52/thumbnail",
            originalUrl: "/api/diary/photos/0198d61d-0f4e-7af2-9be0-0d9576e6ba52/original",
          },
        ],
      }),
    );

    await expect(fetchPhotoDiaries("https://api.example.com")).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/diary/photos", {
      credentials: "include",
    });
    expect(resolvePhotoDiaryImageUrl("https://api.example.com/", "/api/photo")).toBe(
      "https://api.example.com/api/photo",
    );
  });

  it("削除時にapplication sessionのCSRF tokenだけを送る", async () => {
    authSessionRuntime.setCsrfToken("csrf-photo");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ deleted: true }));

    await deletePhotoDiary("https://api.example.com", "photo/id");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.example.com/api/diary/photos/photo%2Fid");
    expect(init).toMatchObject({ method: "DELETE", credentials: "include" });
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-photo");
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  });
});
