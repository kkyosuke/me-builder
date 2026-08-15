import { compatibilityRelationshipCategoryValues } from "@me-builder/lib";
import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

const CompatibilitySharePreviewParameterSchema = v.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  lowLabel: NonEmptyStringSchema,
  highLabel: NonEmptyStringSchema,
  position: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
  statement: NonEmptyStringSchema,
});

/** 相性シートで開示する、生の回答を含まない診断テーマの表示形。 */
export const CompatibilitySharePreviewThemeSchema = v.object({
  diagnosisId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  parameters: v.pipe(v.array(CompatibilitySharePreviewParameterSchema), v.minLength(1)),
});

/** 相性シートで開示する、共有専用projection由来の一人称文章。 */
export const CompatibilityShareProfileSchema = v.object({
  profileSummaryVersionId: NonEmptyStringSchema,
  generatedAt: v.pipe(v.string(), v.isoTimestamp()),
  statements: v.pipe(
    v.array(
      v.object({
        key: NonEmptyStringSchema,
        label: NonEmptyStringSchema,
        statement: NonEmptyStringSchema,
      }),
    ),
    v.minLength(1),
    v.maxLength(3),
  ),
});

export const CompatibilityShareContentQuerySchema = v.object({
  relationshipCategory: v.picklist(compatibilityRelationshipCategoryValues),
});

export const InvalidCompatibilityShareContentRequestSchema = v.object({
  error: v.literal("Invalid request"),
});

export const CompatibilityShareContentResponseSchema = v.object({
  relationshipCategory: v.picklist(compatibilityRelationshipCategoryValues),
  aboutMe: v.nullable(CompatibilityShareProfileSchema),
  themes: v.array(CompatibilitySharePreviewThemeSchema),
  nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
});

export const compatibilityShareContentRoute = describeRoute({
  operationId: "getCompatibilityShareContent",
  tags: ["Compatibility"],
  summary: "本人が相手へ開示する現在の内容をカテゴリ別に確認する",
  security: [{ liffIdToken: [] }],
  parameters: [
    {
      name: "relationshipCategory",
      in: "query",
      required: true,
      schema: { type: "string", enum: [...compatibilityRelationshipCategoryValues] },
      description: "選択した関係カテゴリとgeneralの共有表示を返す",
    },
  ],
  responses: {
    200: jsonResponse("本人が相手へ開示できる現在の内容", CompatibilityShareContentResponseSchema),
    400: jsonResponse("関係カテゴリが不正", InvalidCompatibilityShareContentRequestSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
