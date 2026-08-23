import { accountDataFor } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import {
  PhotoDiaryDeletionResponseSchema,
  PhotoDiaryListResponseSchema,
  PhotoDiaryNotFoundSchema,
} from "../contract/diary/photos";
import { ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

function unavailable(c: Context<AppEnv>): Response {
  logger.error({ path: c.req.path }, "Photo diary storage binding is not configured");
  return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
}

function notFound(c: Context<AppEnv>): Response {
  return c.json(v.parse(PhotoDiaryNotFoundSchema, { error: "Photo diary not found" }), 404);
}

function dependencies(c: Context<AppEnv>) {
  if (!c.env?.ACCOUNT_DATA || !c.env.PHOTO_DIARY_BUCKET) return undefined;
  const accountId = authenticatedActor(c).accountId;
  return {
    accountId,
    accountData: accountDataFor(c.env.ACCOUNT_DATA, accountId),
    bucket: c.env.PHOTO_DIARY_BUCKET,
  };
}

export async function getPhotoDiaries(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "private, no-store");
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  const media = await deps.accountData.execute("photoDiary.list", 50);
  return c.json(
    v.parse(PhotoDiaryListResponseSchema, {
      items: media.map((item) => ({
        id: item.id,
        capturedAt: item.capturedAt.toISOString(),
        mimeType: item.mimeType,
        byteSize: item.byteSize,
        width: item.width,
        height: item.height,
        thumbnailUrl: `/api/diary/photos/${item.id}/thumbnail`,
        originalUrl: `/api/diary/photos/${item.id}/original`,
      })),
    }),
  );
}

export async function getPhotoDiaryImage(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "private, no-store");
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  const media = await deps.accountData.execute("photoDiary.get", c.req.param("mediaId") ?? "");
  if (!media) return notFound(c);
  const variant = c.req.param("variant");
  if (variant !== "thumbnail" && variant !== "original") return notFound(c);
  const object = await deps.bucket.get(
    variant === "thumbnail" ? media.thumbnailObjectKey : media.originalObjectKey,
  );
  if (!object) return notFound(c);
  const expectedContentType = variant === "thumbnail" ? "image/webp" : media.mimeType;
  const expectedSize = variant === "thumbnail" ? media.thumbnailByteSize : media.byteSize;
  if (object.httpMetadata?.contentType !== expectedContentType || object.size !== expectedSize) {
    return notFound(c);
  }
  // CloudflareとDOM libが別々に宣言するReadableStreamはruntimeでは同じbody契約を満たす。
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      "Content-Type": expectedContentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}

export async function deletePhotoDiary(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const deps = dependencies(c);
  if (!deps || !c.env.PHOTO_DIARY_DELETION_QUEUE) return unavailable(c);
  const mediaId = c.req.param("mediaId") ?? "";
  const marked = await deps.accountData.execute("photoDiary.markDeleting", mediaId);
  if (!marked) return notFound(c);
  await c.env.PHOTO_DIARY_DELETION_QUEUE.send({
    type: "photo-diary-deletion",
    accountId: deps.accountId,
    mediaId,
  });
  const enqueued = await deps.accountData.execute("photoDiary.markDeletionEnqueued", mediaId);
  if (!enqueued) throw new Error("Photo diary deletion dispatch state could not be recorded");
  return c.json(v.parse(PhotoDiaryDeletionResponseSchema, { deleted: true }));
}
