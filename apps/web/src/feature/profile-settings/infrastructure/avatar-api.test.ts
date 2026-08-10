// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAvatar,
  fetchAvatarImage,
  fetchAvatarState,
  selectAvatar,
  uploadAvatarSource,
} from "./avatar-api";

const timestamp = "2026-08-10T00:00:00.000Z";
const jobId = "00000000-0000-4000-8000-000000000001";
const candidateId = "00000000-0000-4000-8000-000000000002";

function state(status: "checking" | "verified" | "ready" = "checking") {
  return {
    currentAvatar: null,
    job: {
      id: jobId,
      status,
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp,
      candidates:
        status === "ready"
          ? [
              {
                id: candidateId,
                imageUrl: `/api/avatar/images/${candidateId}`,
                expiresAt: timestamp,
              },
            ]
          : [],
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("avatar-api", () => {
  it("認証付きで状態を取得しRetry-Afterをpolling間隔へ変換する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(state()), {
        status: 200,
        headers: { "Content-Type": "application/json", "Retry-After": "5" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAvatarState("https://api.example.com", "id-token");

    expect(result.retryAfterMilliseconds).toBe(5_000);
    expect(result.state.job?.status).toBe("checking");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/avatar",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("画像と同意をmultipartで送信する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(state("verified")), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["selfie"], "selfie.png", { type: "image/png" });

    await uploadAvatarSource("https://api.example.com", "id-token", file);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer id-token" });
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("consent")).toBe("true");
    expect((init.body as FormData).get("image")).toBe(file);
  });

  it("候補選択を契約どおり送信する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          currentAvatar: {
            id: candidateId,
            imageUrl: `/api/avatar/images/${candidateId}`,
          },
          job: { ...state("ready").job, status: "selected", candidates: [] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await selectAvatar("https://api.example.com", "id-token", candidateId);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.com/api/avatar");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ candidateId }),
        headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" },
      }),
    );
  });

  it("private画像を認証付きBlobとして取得する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["image"], { type: "image/webp" }), {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchAvatarImage(
      "https://api.example.com",
      "id-token",
      `/api/avatar/images/${candidateId}`,
    );

    expect(blob.type).toBe("image/webp");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/avatar/images/${candidateId}`,
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("入力エラーとサービス未設定を利用者向けメッセージへ変換する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Invalid avatar request", reason: "image_too_large" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Service Unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadAvatarSource(
        "https://api.example.com",
        "id-token",
        new File(["x"], "large.png", { type: "image/png" }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "画像は10MB以下にしてください。",
    });
    await expect(deleteAvatar("https://api.example.com", "id-token")).rejects.toMatchObject({
      status: 503,
      message: "アバター機能は現在利用できません。時間をおいてお試しください。",
    });
  });
});
