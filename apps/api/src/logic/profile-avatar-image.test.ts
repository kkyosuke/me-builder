import type { R2Bucket } from "@cloudflare/workers-types";
import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getProfileAvatarImage, resolveProfileAvatarImage } from "./profile-avatar-image";

const db = {} as D1.shared.Client;

function dependencies() {
  return {
    getAvatar: vi.fn().mockResolvedValue(null),
    findLineIdentity: vi.fn().mockResolvedValue("U-line-user"),
    getLinePictureUrl: vi.fn().mockResolvedValue("https://profile.line-scdn.net/avatar"),
    fetchImage: vi.fn().mockResolvedValue(
      new Response(Uint8Array.from([4, 5, 6]), {
        headers: { "Content-Type": "image/jpeg" },
      }),
    ),
  };
}

describe("resolveProfileAvatarImage", () => {
  it("Private R2の設定画像を最優先で返す", async () => {
    const deps = dependencies();
    deps.getAvatar.mockResolvedValue({
      objectKey: "accounts/account-1/profile/avatar/image.png",
      contentType: "image/png",
      byteSize: 3,
      etag: "etag-1",
      updatedAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    const avatarBucket = {
      get: vi.fn().mockResolvedValue({
        etag: "etag-1",
        httpMetadata: { contentType: "image/png" },
        arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer),
      }),
    } as unknown as R2Bucket;

    await expect(
      resolveProfileAvatarImage(
        {
          accountId: "account-1",
          verifiedLinePictureUrl: "https://profile.line-scdn.net/own",
          db,
          avatarBucket,
          lineChannelAccessToken: "line-token",
        },
        deps,
      ),
    ).resolves.toEqual({ bytes: Uint8Array.from([1, 2, 3]), contentType: "image/png" });
    expect(deps.findLineIdentity).not.toHaveBeenCalled();
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  it("本人は検証済みIDトークンのLINE画像をAPI Serverから取得する", async () => {
    const deps = dependencies();
    const avatarBucket = {} as R2Bucket;

    await expect(
      resolveProfileAvatarImage(
        {
          accountId: "account-1",
          verifiedLinePictureUrl: "https://profile.line-scdn.net/own",
          db,
          avatarBucket,
          lineChannelAccessToken: "line-token",
        },
        deps,
      ),
    ).resolves.toEqual({ bytes: Uint8Array.from([4, 5, 6]), contentType: "image/jpeg" });
    expect(deps.findLineIdentity).not.toHaveBeenCalled();
    expect(deps.fetchImage).toHaveBeenCalledWith("https://profile.line-scdn.net/own");
  });

  it("相手はAccountのMessaging API identityからLINE画像を取得する", async () => {
    const deps = dependencies();

    await resolveProfileAvatarImage(
      {
        accountId: "account-partner",
        db,
        avatarBucket: {} as R2Bucket,
        lineChannelAccessToken: "line-token",
      },
      deps,
    );

    expect(deps.findLineIdentity).toHaveBeenCalledWith(db, "account-partner");
    expect(deps.getLinePictureUrl).toHaveBeenCalledWith("line-token", "U-line-user");
    expect(deps.fetchImage).toHaveBeenCalledWith("https://profile.line-scdn.net/avatar");
  });

  it("保存画像とLINE画像を取得できなければnullへ縮退する", async () => {
    const deps = dependencies();
    deps.getAvatar.mockRejectedValue(new Error("D1 unavailable"));
    deps.fetchImage.mockRejectedValue(new Error("LINE unavailable"));

    await expect(
      resolveProfileAvatarImage(
        {
          accountId: "account-partner",
          db,
          avatarBucket: {} as R2Bucket,
          lineChannelAccessToken: "line-token",
        },
        deps,
      ),
    ).resolves.toBeNull();
  });

  it("対応外Content-TypeのLINE応答はnullへ縮退する", async () => {
    const deps = dependencies();
    deps.fetchImage.mockResolvedValue(
      new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
    );

    await expect(
      resolveProfileAvatarImage(
        {
          accountId: "account-1",
          verifiedLinePictureUrl: "https://profile.line-scdn.net/own",
          db,
          avatarBucket: {} as R2Bucket,
        },
        deps,
      ),
    ).resolves.toBeNull();
  });

  it("Content-Lengthがない過大なLINE応答は読取中にnullへ縮退する", async () => {
    const deps = dependencies();
    deps.fetchImage.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(2 * 1024 * 1024));
            controller.enqueue(Uint8Array.from([1]));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "image/jpeg" } },
      ),
    );

    await expect(
      resolveProfileAvatarImage(
        {
          accountId: "account-1",
          verifiedLinePictureUrl: "https://profile.line-scdn.net/own",
          db,
          avatarBucket: {} as R2Bucket,
        },
        deps,
      ),
    ).resolves.toBeNull();
  });
});

describe("getProfileAvatarImage", () => {
  it("検証済み本人のAccountだけを画像解決へ渡す", async () => {
    const resolveAvatarImage = vi.fn().mockResolvedValue({
      bytes: Uint8Array.from([1]),
      contentType: "image/png",
    });
    await expect(
      getProfileAvatarImage(
        {
          idToken: "id-token",
          lineLoginChannelId: "channel-id",
          db,
          avatarBucket: {} as R2Bucket,
        },
        {
          createSession: vi.fn().mockResolvedValue({
            type: "resolved",
            session: {
              accountId: "account-1",
              role: "user",
              displayName: "あおい",
              pictureUrl: "https://profile.line-scdn.net/own",
            },
          }),
          resolveAvatarImage,
        },
      ),
    ).resolves.toMatchObject({ type: "resolved" });
    expect(resolveAvatarImage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-1",
        verifiedLinePictureUrl: "https://profile.line-scdn.net/own",
      }),
    );
  });
});
