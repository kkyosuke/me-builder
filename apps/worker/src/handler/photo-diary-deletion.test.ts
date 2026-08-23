import type { AccountDataNamespace } from "@me-builder/lib";
import type { Message, PhotoDiaryDeletionQueueMessage } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import type { CloudflareBindings } from "../config";
import { processPhotoDiaryDeletionMessage } from "./photo-diary-deletion";

const media = {
  id: "media-1",
  sourceRecordId: "source-1",
  originalObjectKey: "photo-diary/media-1/original",
  thumbnailObjectKey: "photo-diary/media-1/thumbnail.webp",
  mimeType: "image/jpeg" as const,
  byteSize: 1_000,
  thumbnailByteSize: 100,
  storageByteSize: 1_100,
  width: 800,
  height: 600,
  capturedAt: new Date("2026-08-22T01:00:00.000Z"),
  storageStatus: "deleting" as const,
  usageEligibility: "unreviewed" as const,
};

function fixture(found: boolean, deleteError?: Error) {
  const ack = vi.fn();
  const execute = vi.fn(async (_accountId: string, operation: string) => {
    if (operation === "photoDiary.getDeleting") return found ? media : null;
    if (operation === "photoDiary.completeDeletion") return true;
    throw new Error(`unexpected operation: ${operation}`);
  });
  const deleteObjects = deleteError
    ? vi.fn().mockRejectedValue(deleteError)
    : vi.fn().mockResolvedValue(undefined);
  const message = {
    body: { type: "photo-diary-deletion", accountId: "account-1", mediaId: media.id },
    attempts: 1,
    ack,
    retry: vi.fn(),
  } as unknown as Message<PhotoDiaryDeletionQueueMessage>;
  const cf = {
    do: { accountData: { getByName: vi.fn(() => ({ execute })) } as AccountDataNamespace },
    photoDiaryBucket: { delete: deleteObjects },
  } as unknown as CloudflareBindings;
  return { ack, execute, deleteObjects, message, cf };
}

describe("processPhotoDiaryDeletionMessage", () => {
  it("AccountDataが指定する2 objectを消してからtombstoneを確定する", async () => {
    const value = fixture(true);
    await processPhotoDiaryDeletionMessage(value.message, value.cf);

    expect(value.deleteObjects).toHaveBeenCalledWith([
      media.originalObjectKey,
      media.thumbnailObjectKey,
    ]);
    expect(value.execute).toHaveBeenLastCalledWith(
      "account-1",
      "photoDiary.completeDeletion",
      media.id,
    );
    expect(value.ack).toHaveBeenCalledOnce();
  });

  it("既に削除済みならobjectへ触れず冪等にackする", async () => {
    const value = fixture(false);
    await processPhotoDiaryDeletionMessage(value.message, value.cf);

    expect(value.deleteObjects).not.toHaveBeenCalled();
    expect(value.ack).toHaveBeenCalledOnce();
  });

  it("R2削除失敗ではtombstoneを確定せずQueue再試行へ返す", async () => {
    const value = fixture(true, new Error("R2 unavailable"));
    await expect(processPhotoDiaryDeletionMessage(value.message, value.cf)).rejects.toMatchObject({
      code: "PHOTO_DIARY_PHYSICAL_DELETE_FAILED",
      retryable: true,
    });
    expect(value.execute).not.toHaveBeenCalledWith(
      "account-1",
      "photoDiary.completeDeletion",
      media.id,
    );
    expect(value.ack).not.toHaveBeenCalled();
  });
});
