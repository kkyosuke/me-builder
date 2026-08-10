import type { AccountDataNamespace, AccountDataOperation, d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { deleteAvatar, saveAvatar } from "./avatar";

function accountData(
  execute: (operation: AccountDataOperation, ...args: unknown[]) => Promise<unknown>,
): AccountDataNamespace {
  return {
    getByName: () => ({
      execute: (_accountId: string, operation: AccountDataOperation, ...args: unknown[]) =>
        execute(operation, ...args),
    }),
  } as unknown as AccountDataNamespace;
}

const dependencies = {
  createSession: vi.fn(async () => ({
    type: "resolved" as const,
    session: { accountId: "account-1", role: "user" as const },
  })),
  normalizeImage: vi.fn(async () => ({
    bytes: new Uint8Array([1]),
    contentType: "image/webp" as const,
  })),
  createId: () => "00000000-0000-4000-8000-000000000001",
};

const baseParams = {
  idToken: "token",
  lineLoginChannelId: "channel",
  avatarChangeIntervalMs: 0,
  db: {} as d1.Client,
};

describe("avatar logic", () => {
  it("正規化画像をprivate R2へ保存して現在値へ直接設定する", async () => {
    const at = new Date("2026-08-10T00:00:00.000Z");
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.setCurrent") {
        return {
          type: "updated",
          state: {
            currentAvatar: {
              id: dependencies.createId(),
              objectKey: "private-key",
              contentType: "image/webp",
              updatedAt: at,
            },
          },
        };
      }
      throw new Error("Unexpected operation");
    });
    const bucket = { put: vi.fn().mockResolvedValue(undefined) };

    const result = await saveAvatar(
      {
        ...baseParams,
        at,
        accountData: accountData(execute),
        file: new File(["image"], "avatar.webp", { type: "image/webp" }),
        images: {} as ApiBindings["IMAGES"],
        bucket: bucket as unknown as ApiBindings["AVATAR_BUCKET"],
      },
      dependencies,
    );

    expect(bucket.put).toHaveBeenCalledWith(
      "accounts/account-1/avatar/images/00000000-0000-4000-8000-000000000001.webp",
      new Uint8Array([1]),
      { httpMetadata: { contentType: "image/webp" } },
    );
    expect(execute).toHaveBeenCalledWith(
      "avatar.setCurrent",
      expect.objectContaining({ id: dependencies.createId(), contentType: "image/webp" }),
      0,
      at,
    );
    expect(result).toEqual({
      type: "saved",
      state: {
        currentAvatar: {
          id: dependencies.createId(),
          imageUrl: `/api/avatar/images/${dependencies.createId()}`,
        },
      },
    });
  });

  it("変更間隔内なら新規objectを削除対象へ登録する", async () => {
    const retryAt = new Date("2026-08-17T00:00:00.000Z");
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.setCurrent") return { type: "rate-limited", retryAt };
      if (operation === "avatar.scheduleObjectDeletion") return undefined;
      throw new Error("Unexpected operation");
    });

    await expect(
      saveAvatar(
        {
          ...baseParams,
          avatarChangeIntervalMs: 7 * 24 * 60 * 60 * 1000,
          accountData: accountData(execute),
          file: new File(["image"], "avatar.webp", { type: "image/webp" }),
          images: {} as ApiBindings["IMAGES"],
          bucket: { put: vi.fn() } as unknown as ApiBindings["AVATAR_BUCKET"],
        },
        dependencies,
      ),
    ).resolves.toEqual({ type: "rate-limited", retryAt: retryAt.toISOString() });
    expect(execute).toHaveBeenCalledWith(
      "avatar.scheduleObjectDeletion",
      expect.stringContaining("/avatar/images/"),
      expect.any(Date),
    );
  });

  it("現在値の削除をAccountDataへ委譲する", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation !== "avatar.deleteCurrent") throw new Error("Unexpected operation");
      return { type: "deleted" };
    });

    await expect(
      deleteAvatar({ ...baseParams, accountData: accountData(execute) }, dependencies),
    ).resolves.toEqual({ type: "deleted" });
  });
});
