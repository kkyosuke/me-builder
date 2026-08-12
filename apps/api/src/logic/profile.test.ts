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
    createObjectId: vi.fn().mockReturnValue("upload-id"),
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
      "accounts/account-1/profile/avatar/upload-id.png",
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
        objectKey: "accounts/account-1/profile/avatar/upload-id.png",
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

  it("同じ画像を再送してもR2 object keyを再利用しない", async () => {
    const { params, avatarBucket, dependencies } = setup();
    dependencies.createObjectId.mockReturnValueOnce("upload-1").mockReturnValueOnce("upload-2");
    let currentObjectKey = "accounts/account-1/profile/avatar/old.png";
    dependencies.setAvatar.mockImplementation(async (_db, _accountId, avatar) => {
      const previousObjectKey = currentObjectKey;
      currentObjectKey = avatar.objectKey;
      return { outcome: "updated", avatar, previousObjectKey };
    });

    await saveProfileAvatar({ ...params, image }, session.session, dependencies as never);
    await saveProfileAvatar({ ...params, image }, session.session, dependencies as never);

    expect(avatarBucket.put).toHaveBeenNthCalledWith(
      1,
      "accounts/account-1/profile/avatar/upload-1.png",
      image.bytes,
      expect.anything(),
    );
    expect(avatarBucket.put).toHaveBeenNthCalledWith(
      2,
      "accounts/account-1/profile/avatar/upload-2.png",
      image.bytes,
      expect.anything(),
    );
    expect(currentObjectKey).toBe("accounts/account-1/profile/avatar/upload-2.png");
    expect(avatarBucket.delete).not.toHaveBeenCalledWith(currentObjectKey);
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

  it("保存メタデータが指すR2 objectがなければLINE画像へ縮退してerrorログを残す", async () => {
    const { params, avatarBucket, dependencies } = setup();
    dependencies.getAvatar.mockResolvedValue({
      objectKey: "accounts/account-1/profile/avatar/missing.png",
      contentType: "image/png",
      byteSize: 3,
      etag: "etag",
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    });
    vi.mocked(avatarBucket.get).mockResolvedValue(null);
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    await expect(getProfile(params, dependencies as never)).resolves.toEqual({
      type: "resolved",
      profile: {
        role: "user",
        displayName: "利用者",
        avatar: { source: "line", url: session.session.pictureUrl, updatedAt: null },
      },
    });
    expect(dependencies.clearAvatar).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      {
        event: "profile.avatar.read.degraded",
        outcome: "degraded",
        reason: "object-missing",
      },
      "Profile avatar read degraded to the fallback profile",
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(session.session.accountId);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("missing.png");
  });

  it("R2 objectが保存メタデータと一致しなければLINE画像へ縮退する", async () => {
    const { params, avatarBucket, dependencies } = setup();
    dependencies.getAvatar.mockResolvedValue({
      objectKey: "accounts/account-1/profile/avatar/mismatched.png",
      contentType: "image/png",
      byteSize: 3,
      etag: "expected-etag",
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    });
    vi.mocked(avatarBucket.get).mockResolvedValue({
      etag: "different-etag",
      httpMetadata: { contentType: "image/png" },
      arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer),
    } as never);
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    await expect(getProfile(params, dependencies as never)).resolves.toMatchObject({
      type: "resolved",
      profile: { avatar: { source: "line" } },
    });
    expect(errorLog).toHaveBeenCalledWith(
      {
        event: "profile.avatar.read.degraded",
        outcome: "degraded",
        reason: "metadata-mismatch",
      },
      "Profile avatar read degraded to the fallback profile",
    );
  });
});
