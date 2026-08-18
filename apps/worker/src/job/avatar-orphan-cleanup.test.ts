import { describe, expect, it, vi } from "vitest";
import { cleanupAvatarOrphans } from "./avatar-orphan-cleanup";

const now = new Date("2026-08-18T09:00:00.000Z");

function object(key: string, uploaded: string) {
  return {
    key,
    uploaded: new Date(uploaded),
    version: "version",
    size: 10,
    etag: "etag",
    httpEtag: '"etag"',
    checksums: { toJSON: () => ({}) },
    writeHttpMetadata: vi.fn(),
  };
}

function bucket(pages: readonly (readonly ReturnType<typeof object>[])[]) {
  let page = 0;
  const deleteObject = vi.fn(async () => undefined);
  const list = vi.fn(async () => {
    const objects = pages[page] ?? [];
    page += 1;
    return {
      objects,
      truncated: page < pages.length,
      ...(page < pages.length ? { cursor: `page-${page}` } : {}),
      delimitedPrefixes: [],
    };
  });
  return {
    value: { list, delete: deleteObject },
    list,
    deleteObject,
  };
}

describe("cleanupAvatarOrphans", () => {
  it("dry-runでは猶予期間を過ぎた未参照objectを数えるだけにする", async () => {
    const store = bucket([
      [
        object("accounts/a/profile/avatar/current.png", "2026-08-16T00:00:00.000Z"),
        object("accounts/a/profile/avatar/orphan.png", "2026-08-16T00:00:00.000Z"),
      ],
      [object("accounts/a/profile/avatar/recent.png", "2026-08-18T08:30:00.000Z")],
    ]);
    const isReferenced = vi.fn(async (key: string) => key.endsWith("current.png"));

    await expect(
      cleanupAvatarOrphans({ bucket: store.value, mode: "dry-run", now }, { isReferenced }),
    ).resolves.toEqual({
      mode: "dry-run",
      scannedCount: 3,
      candidateCount: 1,
      deletedCount: 0,
      failedCount: 0,
    });
    expect(store.list).toHaveBeenCalledTimes(2);
    expect(store.deleteObject).not.toHaveBeenCalled();
    expect(isReferenced).not.toHaveBeenCalledWith("accounts/a/profile/avatar/recent.png");
  });

  it("deleteでは参照を再確認し、失敗したobjectを飛ばして処理を続ける", async () => {
    const store = bucket([
      [
        object("accounts/a/profile/avatar/first.png", "2026-08-16T00:00:00.000Z"),
        object("accounts/a/profile/avatar/failed.png", "2026-08-16T00:00:00.000Z"),
        object("accounts/a/profile/avatar/last.png", "2026-08-16T00:00:00.000Z"),
      ],
    ]);
    store.deleteObject.mockRejectedValueOnce(new Error("temporary R2 failure"));

    await expect(
      cleanupAvatarOrphans(
        { bucket: store.value, mode: "delete", now },
        { isReferenced: async () => false },
      ),
    ).resolves.toEqual({
      mode: "delete",
      scannedCount: 3,
      candidateCount: 3,
      deletedCount: 2,
      failedCount: 1,
    });
    expect(store.deleteObject).toHaveBeenCalledTimes(3);
  });
});
