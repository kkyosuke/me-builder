import type { AccountDataNamespace, D1 } from "@me-builder/lib";
import {
  type Message,
  type MessageBatch,
  type PhotoDiaryDeletionQueueMessage,
  logger,
} from "@me-builder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudflareBindings } from "../config";
import { getWorkerConfig } from "../config";
import { handleQueueBatch } from "./queue-dispatch";

afterEach(() => vi.restoreAllMocks());

describe("photo diary deletion queue observability", () => {
  it("最終試行のR2削除失敗をDLQ到達として記録する", async () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const execute = vi.fn(async (_accountId: string, operation: string) => {
      if (operation === "photoDiary.getDeleting") {
        return {
          id: "media-1",
          sourceRecordId: "source-1",
          originalObjectKey: "photo-diary/media-1/original",
          thumbnailObjectKey: "photo-diary/media-1/thumbnail.webp",
          mimeType: "image/jpeg",
          byteSize: 3,
          thumbnailByteSize: 2,
          storageByteSize: 5,
          width: 1,
          height: 1,
          capturedAt: new Date("2026-08-22T01:00:00.000Z"),
          storageStatus: "deleting",
          usageEligibility: "unreviewed",
        };
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    const message = {
      id: "queue-message-photo-delete",
      timestamp: new Date("2026-08-22T01:00:00.000Z"),
      attempts: 48,
      body: { type: "photo-diary-deletion", accountId: "account-1", mediaId: "media-1" },
      ack: vi.fn(),
      retry: vi.fn(),
    } as unknown as Message<PhotoDiaryDeletionQueueMessage>;
    const batch = {
      queue: "me-builder-photo-diary-deletion-queue-test",
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<PhotoDiaryDeletionQueueMessage>;
    const cf = {
      d1: {} as D1.shared.Client,
      do: {
        accountData: {
          getByName: vi.fn(() => ({ execute })),
        } as unknown as AccountDataNamespace,
      },
      photoDiaryBucket: { delete: vi.fn().mockRejectedValue(new Error("R2 unavailable")) },
    } as unknown as CloudflareBindings;

    await expect(
      handleQueueBatch(batch, {} as D1.shared.Client, getWorkerConfig({ ENVIRONMENT: "test" }), cf),
    ).rejects.toThrow();
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "photo-diary-deletion",
        attempt: 48,
        disposition: "dead-letter",
        errorCode: "PHOTO_DIARY_PHYSICAL_DELETE_FAILED",
      }),
      expect.stringContaining("-> dead-letter (attempt 48/48"),
    );
  });
});
