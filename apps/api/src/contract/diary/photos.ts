import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ServiceUnavailableErrorSchema,
  authenticatedErrors,
  csrfValidationError,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

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

export const PhotoDiaryListResponseSchema = v.object({ items: v.array(PhotoDiaryItemSchema) });
export const PhotoDiaryDeletionResponseSchema = v.object({ deleted: v.literal(true) });
export const PhotoDiaryNotFoundSchema = v.object({ error: v.literal("Photo diary not found") });

const storageErrors = {
  ...authenticatedErrors,
  ...currentTermsPolicyError,
  503: jsonResponse("AccountDataまたはPrivate R2が未設定", ServiceUnavailableErrorSchema),
};
const notFoundError = {
  404: jsonResponse("写真がない、または削除済み", PhotoDiaryNotFoundSchema),
};

export const photoDiaryListRoute = describeRoute({
  operationId: "listPhotoDiaries",
  tags: ["Diary"],
  summary: "本人の写真日記を新しい順で取得する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse("写真日記一覧", PhotoDiaryListResponseSchema),
    ...storageErrors,
  },
} satisfies DescribeRouteOptions);

export const photoDiaryImageRoute = describeRoute({
  operationId: "getPhotoDiaryImage",
  tags: ["Diary"],
  summary: "本人の写真日記画像を認証付きで取得する",
  security: [{ applicationSession: [] }],
  parameters: [
    { name: "mediaId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    {
      name: "variant",
      in: "path",
      required: true,
      schema: { type: "string", enum: ["thumbnail", "original"] },
    },
  ],
  responses: {
    200: {
      description: "写真原本またはEXIFを除いたthumbnail",
      content: Object.fromEntries(
        ["image/jpeg", "image/png", "image/webp"].map((contentType) => [
          contentType,
          { schema: { type: "string", format: "binary" } },
        ]),
      ),
    },
    ...notFoundError,
    ...storageErrors,
  },
} satisfies DescribeRouteOptions);

export const photoDiaryDeleteRoute = describeRoute({
  operationId: "deletePhotoDiary",
  tags: ["Diary"],
  summary: "本人の写真日記を直ちに利用停止して物理削除を依頼する",
  security: [{ applicationSession: [], csrfToken: [] }],
  parameters: [
    { name: "mediaId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
  ],
  responses: {
    200: jsonResponse("利用停止済み", PhotoDiaryDeletionResponseSchema),
    ...csrfValidationError,
    ...notFoundError,
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    503: jsonResponse("AccountData、削除Queue、Private R2が未設定", ServiceUnavailableErrorSchema),
  },
} satisfies DescribeRouteOptions);
