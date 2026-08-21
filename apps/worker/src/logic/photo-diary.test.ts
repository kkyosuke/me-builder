import { type AccountDataNamespace, billing } from "@me-builder/lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "../config";
import type { CloudflareBindings } from "../config";
import {
  MAX_PHOTO_DIARY_BYTES,
  MAX_PHOTO_DIARY_PIXELS,
  processPhotoDiaryImage,
  validatePhotoDiaryImage,
} from "./photo-diary";

afterEach(() => vi.restoreAllMocks());

function imagesInfo(result: unknown): ImagesBinding {
  return { info: vi.fn().mockResolvedValue(result) } as unknown as ImagesBinding;
}

function response(bytes: Uint8Array, contentType: string): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: { "Content-Type": contentType },
  });
}

function pngChunk(type: string, data: readonly number[] = []): number[] {
  const length = data.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...[...type].map((value) => value.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("validatePhotoDiaryImage", () => {
  it("magic bytes、declared MIME、decode結果が一致する静止画だけを受理する", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const result = await validatePhotoDiaryImage(
      response(bytes, "image/jpeg"),
      imagesInfo({ format: "jpeg", width: 2_000, height: 1_500 }),
    );

    expect(result).toMatchObject({ mimeType: "image/jpeg", width: 2_000, height: 1_500 });
    expect(result?.bytes).toEqual(bytes);
  });

  it("headerと実形式が異なる画像、壊れた画像、pixel上限超過を拒否する", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await expect(
      validatePhotoDiaryImage(
        response(bytes, "image/png"),
        imagesInfo({
          format: "jpeg",
          width: 1,
          height: 1,
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      validatePhotoDiaryImage(
        response(bytes, "image/jpeg"),
        imagesInfo({ format: "jpeg", width: MAX_PHOTO_DIARY_PIXELS + 1, height: 1 }),
      ),
    ).resolves.toBeNull();
    const decoder = { info: vi.fn().mockRejectedValue(new Error("decode failed")) };
    await expect(
      validatePhotoDiaryImage(response(bytes, "image/jpeg"), decoder as unknown as ImagesBinding),
    ).resolves.toBeNull();
  });

  it("Content-Lengthで10MB超過が分かる場合はdecoderへ渡さない", async () => {
    const images = imagesInfo({ format: "jpeg", width: 1, height: 1 });
    const oversized = new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(MAX_PHOTO_DIARY_BYTES + 1),
      },
    });

    await expect(validatePhotoDiaryImage(oversized, images)).resolves.toBeNull();
    expect(images.info).not.toHaveBeenCalled();
  });

  it("APNGのacTL chunkを拒否し、通常chunk内の同じ文字列は誤検出しない", async () => {
    const animated = new Uint8Array([...PNG_SIGNATURE, ...pngChunk("acTL")]);
    const staticWithText = new Uint8Array([
      ...PNG_SIGNATURE,
      ...pngChunk(
        "tEXt",
        [..."acTL"].map((value) => value.charCodeAt(0)),
      ),
    ]);
    const info = { format: "png", width: 100, height: 100 };

    await expect(
      validatePhotoDiaryImage(response(animated, "image/png"), imagesInfo(info)),
    ).resolves.toBeNull();
    await expect(
      validatePhotoDiaryImage(response(staticWithText, "image/png"), imagesInfo(info)),
    ).resolves.toMatchObject({ mimeType: "image/png" });
  });
});

describe("processPhotoDiaryImage retry", () => {
  it("保存済みmessageの再配送では期限付きLINE contentを再取得しない", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const execute = vi.fn(async (_accountId: string, operation: string) => {
      if (operation === "photoDiary.findByLineMessage") {
        return {
          id: "media-1",
          sourceRecordId: "source-1",
          originalObjectKey: "photo-diary/media-1/original",
          thumbnailObjectKey: "photo-diary/media-1/thumbnail.webp",
          mimeType: "image/jpeg",
          byteSize: 1_000,
          thumbnailByteSize: 100,
          storageByteSize: 1_100,
          width: 800,
          height: 600,
          capturedAt: new Date("2026-08-22T01:00:00.000Z"),
          storageStatus: "available",
          usageEligibility: "unreviewed",
        };
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    const cf = {
      do: { accountData: { getByName: () => ({ execute }) } as AccountDataNamespace },
      photoDiaryBucket: {},
      images: {},
    } as unknown as CloudflareBindings;

    await expect(
      processPhotoDiaryImage(
        {
          webhookEventId: "event-1",
          timestamp: Date.parse("2026-08-22T01:00:00.000Z"),
          source: { type: "user", userId: "line-user" },
          message: { id: "message-1", type: "image", contentProvider: { type: "line" } },
        },
        "account-1",
        cf,
        getWorkerConfig({ LINE_CHANNEL_ACCESS_TOKEN: "line-token" }),
      ),
    ).resolves.toBe("duplicate");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("不完全なR2予約を削除・解放してから再取得し、古いsize予約を再利用しない", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    const existing = {
      id: "media-reserved",
      sourceRecordId: "source-reserved",
      originalObjectKey: "photo-diary/media-reserved/original",
      thumbnailObjectKey: "photo-diary/media-reserved/thumbnail.webp",
      mimeType: "image/jpeg" as const,
      byteSize: 1_000,
      thumbnailByteSize: 100,
      storageByteSize: 1_100,
      width: 800,
      height: 600,
      capturedAt: new Date("2026-08-22T01:00:00.000Z"),
      storageStatus: "reserved" as const,
      usageEligibility: "unreviewed" as const,
    };
    const execute = vi.fn(async (_accountId: string, operation: string) => {
      if (operation === "photoDiary.findByLineMessage") return existing;
      if (operation === "photoDiary.releaseReservation") return true;
      if (operation === "photoDiary.readStorageUsage") return 0;
      throw new Error(`unexpected operation: ${operation}`);
    });
    const deleteObjects = vi.fn().mockResolvedValue(undefined);
    const cf = {
      d1: {},
      do: { accountData: { getByName: () => ({ execute }) } as AccountDataNamespace },
      photoDiaryBucket: {
        head: vi.fn().mockResolvedValue(null),
        delete: deleteObjects,
      },
      images: {},
      planAssignmentProvider: new billing.FakeAccountPlanAssignmentProvider(),
    } as unknown as CloudflareBindings;

    await expect(
      processPhotoDiaryImage(
        {
          webhookEventId: "event-retry",
          timestamp: Date.parse("2026-08-22T01:00:00.000Z"),
          source: { type: "user", userId: "line-user" },
          message: { id: "message-retry", type: "image", contentProvider: { type: "line" } },
        },
        "account-1",
        cf,
        getWorkerConfig({ LINE_CHANNEL_ACCESS_TOKEN: "line-token" }),
      ),
    ).resolves.toBe("invalid");
    expect(deleteObjects).toHaveBeenCalledWith([
      existing.originalObjectKey,
      existing.thumbnailObjectKey,
    ]);
    expect(execute).toHaveBeenCalledWith("account-1", "photoDiary.releaseReservation", existing.id);
    expect(execute).toHaveBeenCalledWith("account-1", "photoDiary.readStorageUsage");
  });
});
