import type { R2Bucket } from "@cloudflare/workers-types";
import type { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ValidAvatarImage } from "./avatar-image";
import { deleteProfileAvatar, getProfile, saveProfileAvatar } from "./profile";

const image: ValidAvatarImage = {
  type: "valid",
  bytes: Uint8Array.from([1, 2, 3]),
  contentType: "image/png",
  extension: "png",
  width: 1,
  height: 1,
};

const session = {
  type: "resolved" as const,
  session: {
    accountId: "account-1",
    role: "user" as const,
    displayName: "利用者",
    pictureUrl: "https://profile.line-scdn.net/avatar",
  },
};

function setup() {
  const avatarBucket = {
    get: vi.fn(),
    put: vi.fn().mockResolvedValue({ etag: "etag-new" }),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as R2Bucket;
  const params = {
    idToken: "token",
    lineLoginChannelId: "channel",
    db: {} as D1.shared.Client,
    avatarBucket,
  };
  const dependencies = {
    createSession: vi.fn().mockResolvedValue(session),
    digest: vi.fn().mockResolvedValue("digest"),
    getAvatar: vi.fn(),
    setAvatar: vi.fn(),
    clearAvatar: vi.fn(),
  };
  return { params, avatarBucket, dependencies };
}

describe("Profile logic", () => {
  afterEach(() => vi.restoreAllMocks());

  it("D1更新に失敗した場合は新しいR2 objectを削除する", async () => {
    const { params, avatarBucket, dependencies } = setup();
    dependencies.getAvatar.mockResolvedValue(null);
    dependencies.setAvatar.mockRejectedValue(new Error("D1 unavailable"));

    await expect(
      saveProfileAvatar({ ...params, image }, session.session, dependencies as never),
    ).rejects.toThrow("D1 unavailable");
    expect(avatarBucket.put).toHaveBeenCalledOnce();
    expect(avatarBucket.delete).toHaveBeenCalledWith(
      "accounts/account-1/profile/avatar/digest.png",
    );
  });

  it("D1更新後の参照を確認できない場合はR2 objectを削除せずerrorログを残す", async () => {
    const { params, avatarBucket, dependencies } = setup();
    dependencies.getAvatar.mockRejectedValue(new Error("D1 unavailable"));
    dependencies.setAvatar.mockRejectedValue(new Error("D1 update failed"));
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    await expect(
      saveProfileAvatar({ ...params, image }, session.session, dependencies as never),
    ).rejects.toThrow("D1 update failed");
    expect(avatarBucket.delete).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      { event: "profile.avatar.rollback.reference-check.failed", outcome: "failed" },
      "Profile avatar reference could not be checked after metadata update failure",
    );
  });

  it("旧R2 objectの削除失敗をerrorログへ記録する", async () => {
    const { params, avatarBucket, dependencies } = setup();
    dependencies.getAvatar.mockResolvedValue({
      objectKey: "accounts/account-1/profile/avatar/old.png",
      contentType: "image/png",
      byteSize: 3,
      etag: "etag-old",
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    dependencies.setAvatar.mockResolvedValue({
      outcome: "updated",
      avatar: {
        objectKey: "accounts/account-1/profile/avatar/digest.png",
        contentType: "image/png",
        byteSize: 3,
        etag: "etag-new",
        updatedAt: new Date("2026-08-11T00:00:00.000Z"),
      },
      previousObjectKey: "accounts/account-1/profile/avatar/old.png",
    });
    vi.mocked(avatarBucket.delete).mockRejectedValue(new Error("R2 unavailable"));
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    await expect(
      saveProfileAvatar({ ...params, image }, session.session, dependencies as never),
    ).resolves.toMatchObject({ type: "resolved" });
    expect(errorLog).toHaveBeenCalledWith(
      { event: "profile.avatar.cleanup.failed", outcome: "failed" },
      "Old profile avatar could not be removed after replacement",
    );
  });

  it("プロフィール画像削除時のR2失敗をerrorログへ記録する", async () => {
    const { params, avatarBucket, dependencies } = setup();
    dependencies.clearAvatar.mockResolvedValue({
      outcome: "cleared",
      previousObjectKey: "accounts/account-1/profile/avatar/old.png",
    });
    vi.mocked(avatarBucket.delete).mockRejectedValue(new Error("R2 unavailable"));
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    await expect(deleteProfileAvatar(params, dependencies as never)).resolves.toMatchObject({
      type: "resolved",
    });
    expect(errorLog).toHaveBeenCalledWith(
      { event: "profile.avatar.cleanup.failed", outcome: "failed" },
      "Profile avatar could not be removed after metadata deletion",
    );
  });

  it("保存メタデータが指すR2 objectがなければLINE画像へ暗黙に戻さない", async () => {
    const { params, avatarBucket, dependencies } = setup();
    dependencies.getAvatar.mockResolvedValue({
      objectKey: "accounts/account-1/profile/avatar/missing.png",
      contentType: "image/png",
      byteSize: 3,
      etag: "etag",
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    });
    vi.mocked(avatarBucket.get).mockResolvedValue(null);

    await expect(getProfile(params, dependencies as never)).rejects.toThrow(
      "Profile avatar metadata references a missing object",
    );
  });
});
