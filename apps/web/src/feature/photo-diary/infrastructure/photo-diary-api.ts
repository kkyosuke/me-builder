import * as v from "valibot";
import { OperationError, ValidationError } from "../../../infrastructure/errors";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";

const PhotoDiaryItemSchema = v.object({
  id: v.pipe(v.string(), v.uuid()),
  capturedAt: v.pipe(v.string(), v.isoTimestamp()),
  mimeType: v.picklist(["image/jpeg", "image/png", "image/webp"]),
  byteSize: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  width: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  height: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  thumbnailUrl: v.pipe(v.string(), v.nonEmpty()),
  originalUrl: v.pipe(v.string(), v.nonEmpty()),
});
const PhotoDiaryListSchema = v.object({ items: v.array(PhotoDiaryItemSchema) });
export type PhotoDiaryItem = v.InferOutput<typeof PhotoDiaryItemSchema>;

export function resolvePhotoDiaryImageUrl(apiUrl: string | undefined, path: string): string {
  return `${(apiUrl ?? "").replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function fetchPhotoDiaries(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<readonly PhotoDiaryItem[]> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/diary/photos", {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new OperationError("写真日記を取得できませんでした。", {
      code: "PHOTO_DIARY_LIST_FAILED",
      status: response.status,
    });
  }
  try {
    return v.parse(PhotoDiaryListSchema, await response.json()).items;
  } catch (error) {
    throw new ValidationError("写真日記の応答を確認できませんでした。", {
      code: "PHOTO_DIARY_RESPONSE_INVALID",
      cause: error,
    });
  }
}

export async function deletePhotoDiary(apiUrl: string | undefined, mediaId: string): Promise<void> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/diary/photos/${encodeURIComponent(mediaId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new OperationError("写真日記を削除できませんでした。", {
      code: "PHOTO_DIARY_DELETE_FAILED",
      status: response.status,
    });
  }
}
