import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ServiceUnavailableErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const profileErrors = {
  ...authenticatedErrors,
  ...currentTermsPolicyError,
  503: jsonResponse("D1またはPrivate R2 bindingが設定されていない", ServiceUnavailableErrorSchema),
};

export const ProfileResponseSchema = v.object({
  role: v.picklist(["user", "admin"]),
  displayName: v.optional(NonEmptyStringSchema),
  avatar: v.nullable(
    v.object({
      source: v.picklist(["uploaded", "line"]),
      url: NonEmptyStringSchema,
      updatedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
    }),
  ),
});

export const AvatarInputErrorSchema = v.object({
  error: v.picklist([
    "Avatar image is empty",
    "Avatar image is too large",
    "Unsupported avatar image",
    "Avatar image dimensions are invalid",
  ]),
});
const EmptyAvatarErrorSchema = v.object({ error: v.literal("Avatar image is empty") });
const LargeAvatarErrorSchema = v.object({ error: v.literal("Avatar image is too large") });
const UnsupportedAvatarErrorSchema = v.object({ error: v.literal("Unsupported avatar image") });
const InvalidAvatarSizeErrorSchema = v.object({
  error: v.literal("Avatar image dimensions are invalid"),
});

export const getProfileRoute = describeRoute({
  operationId: "getProfile",
  tags: ["Profile"],
  summary: "本人の表示用プロフィールを取得する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse("本人の表示名、role、現在表示するアバター", ProfileResponseSchema),
    ...profileErrors,
  },
} satisfies DescribeRouteOptions);

export const getProfileAvatarImageRoute = describeRoute({
  operationId: "getProfileAvatarImage",
  tags: ["Profile"],
  summary: "本人の現在のアバター画像を取得する",
  security: [{ applicationSession: [] }],
  responses: {
    200: {
      description: "本人の現在のアバター画像",
      content: Object.fromEntries(
        ["image/jpeg", "image/png", "image/webp"].map((contentType) => [
          contentType,
          { schema: { type: "string", format: "binary" } },
        ]),
      ),
    },
    204: { description: "表示できるアバター画像がない" },
    ...profileErrors,
  },
} satisfies DescribeRouteOptions);

export const putProfileAvatarRoute = describeRoute({
  operationId: "putProfileAvatar",
  tags: ["Profile"],
  summary: "本人のアバター画像を保存する",
  security: [{ applicationSession: [], csrfToken: [] }],
  requestBody: {
    required: true,
    content: Object.fromEntries(
      ["image/jpeg", "image/png", "image/webp"].map((contentType) => [
        contentType,
        { schema: { type: "string", format: "binary" } },
      ]),
    ),
  },
  responses: {
    200: jsonResponse("保存後のプロフィール", ProfileResponseSchema),
    400: jsonResponse("画像bodyが空", EmptyAvatarErrorSchema),
    413: jsonResponse("画像が2 MiBを超える", LargeAvatarErrorSchema),
    415: jsonResponse(
      "対応外形式またはContent-Typeと実データが一致しない",
      UnsupportedAvatarErrorSchema,
    ),
    422: jsonResponse(
      "画像寸法が取得できない、非正方形、または512pxを超える",
      InvalidAvatarSizeErrorSchema,
    ),
    ...profileErrors,
  },
} satisfies DescribeRouteOptions);

export const deleteProfileAvatarRoute = describeRoute({
  operationId: "deleteProfileAvatar",
  tags: ["Profile"],
  summary: "保存したアバターを外してLINE画像へ戻す",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    200: jsonResponse("削除後のプロフィール", ProfileResponseSchema),
    ...profileErrors,
  },
} satisfies DescribeRouteOptions);
