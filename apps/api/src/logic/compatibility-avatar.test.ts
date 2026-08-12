import type { R2Bucket } from "@cloudflare/workers-types";
import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { resolveCompatibilityAvatarUrl } from "./compatibility-avatar";

const db = {} as D1.shared.Client;

function dependencies() {
  return {
    getAvatar: vi.fn().mockResolvedValue(null),
    findLineIdentity: vi.fn().mockResolvedValue("U-line-user"),
    getLinePictureUrl: vi.fn().mockResolvedValue("https://profile.line-scdn.net/avatar"),
  };
}

describe("resolveCompatibilityAvatarUrl", () => {
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
      resolveCompatibilityAvatarUrl(
        {
          accountId: "account-1",
          verifiedLinePictureUrl: "https://profile.line-scdn.net/own",
          db,
          avatarBucket,
          lineChannelAccessToken: "line-token",
        },
        deps,
      ),
    ).resolves.toBe("data:image/png;base64,AQID");
    expect(deps.findLineIdentity).not.toHaveBeenCalled();
  });

  it("本人は検証済みIDトークンのLINE画像へ縮退する", async () => {
    const deps = dependencies();

    await expect(
      resolveCompatibilityAvatarUrl(
        {
          accountId: "account-1",
          verifiedLinePictureUrl: "https://profile.line-scdn.net/own",
          db,
          lineChannelAccessToken: "line-token",
        },
        deps,
      ),
    ).resolves.toBe("https://profile.line-scdn.net/own");
    expect(deps.findLineIdentity).not.toHaveBeenCalled();
  });

  it("相手はAccountのMessaging API identityからLINE画像を取得する", async () => {
    const deps = dependencies();

    await expect(
      resolveCompatibilityAvatarUrl(
        { accountId: "account-partner", db, lineChannelAccessToken: "line-token" },
        deps,
      ),
    ).resolves.toBe("https://profile.line-scdn.net/avatar");
    expect(deps.findLineIdentity).toHaveBeenCalledWith(db, "account-partner");
    expect(deps.getLinePictureUrl).toHaveBeenCalledWith("line-token", "U-line-user");
  });

  it("保存画像とLINE画像を取得できなくても既定表示用のnullへ縮退する", async () => {
    const deps = dependencies();
    deps.getAvatar.mockRejectedValue(new Error("D1 unavailable"));
    deps.getLinePictureUrl.mockRejectedValue(new Error("LINE unavailable"));

    await expect(
      resolveCompatibilityAvatarUrl(
        { accountId: "account-partner", db, lineChannelAccessToken: "line-token" },
        deps,
      ),
    ).resolves.toBeNull();
  });
});
