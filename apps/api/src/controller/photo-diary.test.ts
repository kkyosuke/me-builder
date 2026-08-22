import type { Queue, R2Bucket } from "@cloudflare/workers-types";
import type { AccountDataNamespace } from "@me-builder/lib";
import type { PhotoDiaryDeletionQueueMessage } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

vi.mock("../middleware/authentication", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authentication")>();
  return {
    ...actual,
    requireAuthentication: async (
      c: Parameters<typeof actual.requireAuthentication>[0],
      next: () => Promise<void>,
    ) => {
      const actor = {
        accountId: "account-1",
        authenticationMethod: "liff" as const,
        authenticatedAt: new Date("2026-08-22T01:00:00.000Z"),
      };
      c.set("authenticatedActor", actor);
      c.set("authenticationResult", { type: "authenticated", actor, accountRole: "user" });
      await next();
    },
  };
});
vi.mock("../middleware/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authorization")>();
  return {
    ...actual,
    requireCurrentTerms: async (_c: unknown, next: () => Promise<void>) => next(),
  };
});

const media = {
  id: "0198d61d-0f4e-7af2-9be0-0d9576e6ba52",
  sourceRecordId: "source-1",
  originalObjectKey: "photo-diary/private/original",
  thumbnailObjectKey: "photo-diary/private/thumbnail.webp",
  mimeType: "image/jpeg" as const,
  byteSize: 3,
  thumbnailByteSize: 2,
  storageByteSize: 5,
  width: 800,
  height: 600,
  capturedAt: new Date("2026-08-22T01:00:00.000Z"),
  storageStatus: "available" as const,
  usageEligibility: "unreviewed" as const,
};

function fixture(queueError?: Error) {
  const execute = vi.fn(async (_accountId: string, operation: string) => {
    if (operation === "photoDiary.list") return [media];
    if (operation === "photoDiary.get") return media;
    if (operation === "photoDiary.markDeleting") return true;
    if (operation === "photoDiary.markDeletionEnqueued") return true;
    throw new Error(`unexpected operation: ${operation}`);
  });
  const send = queueError
    ? vi.fn().mockRejectedValue(queueError)
    : vi.fn().mockResolvedValue(undefined);
  const bucket = {
    get: vi.fn(async (key: string) => ({
      body: Uint8Array.from(key.endsWith("thumbnail.webp") ? [1, 2] : [1, 2, 3]),
      size: key.endsWith("thumbnail.webp") ? 2 : 3,
      httpMetadata: {
        contentType: key.endsWith("thumbnail.webp") ? "image/webp" : "image/jpeg",
      },
    })),
  } as unknown as R2Bucket;
  const env = {
    LIFF_ID: "2010850319-Yl63upAR",
    ACCOUNT_DATA: { getByName: vi.fn(() => ({ execute })) } as AccountDataNamespace,
    PHOTO_DIARY_BUCKET: bucket,
    PHOTO_DIARY_DELETION_QUEUE: { send } as unknown as Queue<PhotoDiaryDeletionQueueMessage>,
  };
  return { bucket, env, execute, send };
}

describe("photo diary controller", () => {
  beforeEach(() => vi.clearAllMocks());

  it("本人の一覧にはprivate R2 keyを公開せず、認証付きURLだけを返す", async () => {
    const value = fixture();
    const response = await app.request("/api/diary/photos", {}, value.env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.text();
    expect(body).not.toContain(media.originalObjectKey);
    expect(JSON.parse(body)).toMatchObject({
      items: [
        {
          id: media.id,
          thumbnailUrl: `/api/diary/photos/${media.id}/thumbnail`,
          originalUrl: `/api/diary/photos/${media.id}/original`,
        },
      ],
    });
  });

  it("画像はR2のMIMEとsizeを照合してprivate no-storeで返す", async () => {
    const value = fixture();
    const response = await app.request(`/api/diary/photos/${media.id}/thumbnail`, {}, value.env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2]));
  });

  it("削除状態を先に永続化し、Queue送信後に配送済みを記録する", async () => {
    const value = fixture();
    const response = await app.request(
      `/api/diary/photos/${media.id}`,
      { method: "DELETE" },
      value.env,
    );

    expect(response.status).toBe(200);
    expect(value.send).toHaveBeenCalledWith({
      type: "photo-diary-deletion",
      accountId: "account-1",
      mediaId: media.id,
    });
    expect(value.execute).toHaveBeenNthCalledWith(
      1,
      "account-1",
      "photoDiary.markDeleting",
      media.id,
    );
    expect(value.execute).toHaveBeenNthCalledWith(
      2,
      "account-1",
      "photoDiary.markDeletionEnqueued",
      media.id,
    );
    expect(value.execute.mock.invocationCallOrder[0]).toBeLessThan(
      value.send.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("Queue送信失敗時は未配送状態を残して500とし、Alarm回収を可能にする", async () => {
    const value = fixture(new Error("Queue unavailable"));
    const response = await app.request(
      `/api/diary/photos/${media.id}`,
      { method: "DELETE" },
      value.env,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(value.execute).toHaveBeenCalledWith("account-1", "photoDiary.markDeleting", media.id);
    expect(value.execute).not.toHaveBeenCalledWith(
      "account-1",
      "photoDiary.markDeletionEnqueued",
      media.id,
    );
  });
});
