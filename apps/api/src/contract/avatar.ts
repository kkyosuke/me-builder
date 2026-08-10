import { toJsonSchema } from "@valibot/to-json-schema";
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

const AvatarCandidateSchema = v.object({
  id: IdSchema,
  imageUrl: v.pipe(v.string(), v.nonEmpty()),
  expiresAt: TimestampSchema,
});

const AvatarJobSchema = v.object({
  id: IdSchema,
  status: v.picklist([
    "checking",
    "not_person",
    "verified",
    "accepted",
    "generating",
    "ready",
    "failed",
    "cancelled",
    "selected",
    "expired",
  ]),
  errorCode: v.nullable(v.string()),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  candidates: v.array(AvatarCandidateSchema),
});

export const AvatarStateResponseSchema = v.object({
  currentAvatar: v.nullable(
    v.object({
      id: IdSchema,
      imageUrl: v.pipe(v.string(), v.nonEmpty()),
    }),
  ),
  job: v.nullable(AvatarJobSchema),
});

export const SelectAvatarRequestSchema = v.object({ candidateId: IdSchema });
export const AvatarInvalidRequestSchema = v.object({
  error: v.literal("Invalid avatar request"),
  reason: v.picklist([
    "consent_required",
    "image_required",
    "unsupported_image_type",
    "image_too_large",
    "invalid_image",
  ]),
});
export const AvatarSelectionInvalidRequestSchema = v.object({
  error: v.literal("Invalid avatar request"),
  reason: v.literal("candidate_required"),
});
export const AvatarConflictSchema = v.object({
  error: v.literal("Avatar state conflict"),
  reason: v.literal("invalid_job_state"),
});
export const AvatarNotFoundSchema = v.object({ error: v.literal("Avatar not found") });
export const getAvatarRoute = describeRoute({
  operationId: "getAvatar",
  tags: ["Avatar"],
  summary: "現在のアバターと最新の生成状態を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("現在値と最新ジョブ", AvatarStateResponseSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);

export const uploadAvatarRoute = describeRoute({
  operationId: "uploadAvatarSource",
  tags: ["Avatar"],
  summary: "画像をアップロードして人物判定を受け付ける",
  security: [{ liffIdToken: [] }],
  requestBody: {
    required: true,
    content: {
      "multipart/form-data": {
        schema: {
          type: "object",
          properties: {
            image: { type: "string", format: "binary" },
            consent: { type: "string", enum: ["true"] },
          },
          required: ["image", "consent"],
        } as RequestSchema,
      },
    },
  },
  responses: {
    202: jsonResponse("人物判定を受け付けた状態", AvatarStateResponseSchema),
    ...authenticatedErrors,
    400: jsonResponse("同意または画像が不正", AvatarInvalidRequestSchema),
  },
} satisfies DescribeRouteOptions);

export const selectAvatarRoute = describeRoute({
  operationId: "selectAvatar",
  tags: ["Avatar"],
  summary: "生成候補を現在のアバターに設定する",
  security: [{ liffIdToken: [] }],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: toJsonSchema(SelectAvatarRequestSchema) as unknown as RequestSchema,
      },
    },
  },
  responses: {
    200: jsonResponse("更新後の現在値", AvatarStateResponseSchema),
    ...authenticatedErrors,
    404: jsonResponse("候補がない", AvatarNotFoundSchema),
    400: jsonResponse("候補IDが不正", AvatarSelectionInvalidRequestSchema),
    409: jsonResponse("選択できない状態", AvatarConflictSchema),
  },
} satisfies DescribeRouteOptions);

export const deleteAvatarRoute = describeRoute({
  operationId: "deleteAvatar",
  tags: ["Avatar"],
  summary: "現在のアバターを削除する",
  security: [{ liffIdToken: [] }],
  responses: { 204: { description: "削除した" }, ...authenticatedErrors },
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
