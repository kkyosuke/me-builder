import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "./shared/errors";

const IdSchema = v.pipe(v.string(), v.uuid());
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());
type RequestBodyObject = Exclude<
  NonNullable<DescribeRouteOptions["requestBody"]>,
  { $ref: string }
>;
type RequestSchema = NonNullable<RequestBodyObject["content"][string]["schema"]>;

export const AvatarStateResponseSchema = v.object({
  currentAvatar: v.nullable(
    v.object({
      id: IdSchema,
      imageUrl: v.pipe(v.string(), v.nonEmpty()),
    }),
  ),
});

export const AvatarInvalidRequestSchema = v.object({
  error: v.literal("Invalid avatar request"),
  reason: v.picklist([
    "image_required",
    "unsupported_image_type",
    "image_too_large",
    "invalid_image",
  ]),
});
export const AvatarNotFoundSchema = v.object({ error: v.literal("Avatar not found") });
export const AvatarChangeRateLimitedSchema = v.object({
  error: v.literal("Avatar change rate limited"),
  retryAt: TimestampSchema,
});

export const getAvatarRoute = describeRoute({
  operationId: "getAvatar",
  tags: ["Avatar"],
  summary: "現在のアバターを取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("現在のアバター", AvatarStateResponseSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);

export const saveAvatarRoute = describeRoute({
  operationId: "saveAvatar",
  tags: ["Avatar"],
  summary: "画像をアップロードして現在のアバターに設定する",
  security: [{ liffIdToken: [] }],
  requestBody: {
    required: true,
    content: {
      "multipart/form-data": {
        schema: {
          type: "object",
          properties: { image: { type: "string", format: "binary" } },
          required: ["image"],
        } as RequestSchema,
      },
    },
  },
  responses: {
    200: jsonResponse("更新後の現在値", AvatarStateResponseSchema),
    ...authenticatedErrors,
    400: jsonResponse("画像が不正", AvatarInvalidRequestSchema),
    429: jsonResponse("プロフィール変更間隔の制限中", AvatarChangeRateLimitedSchema),
  },
} satisfies DescribeRouteOptions);

export const deleteAvatarRoute = describeRoute({
  operationId: "deleteAvatar",
  tags: ["Avatar"],
  summary: "現在のアバターを削除する",
  security: [{ liffIdToken: [] }],
  responses: {
    204: { description: "削除した、または現在値がなかった" },
    ...authenticatedErrors,
    429: jsonResponse("プロフィール変更間隔の制限中", AvatarChangeRateLimitedSchema),
  },
} satisfies DescribeRouteOptions);

export const getAvatarImageRoute = describeRoute({
  operationId: "getAvatarImage",
  tags: ["Avatar"],
  summary: "本人が参照可能なアバター画像を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: {
      description: "private R2の画像",
      content: { "image/webp": { schema: { type: "string", format: "binary" } } },
    },
    ...authenticatedErrors,
    404: jsonResponse("画像がない", AvatarNotFoundSchema),
  },
} satisfies DescribeRouteOptions);
