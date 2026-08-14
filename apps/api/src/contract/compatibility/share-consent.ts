import { compatibilityRelationshipCategoryValues } from "@me-builder/lib";
import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

const CompatibilityShareConsentBlockingReasonSchema = v.picklist(["display_name_unavailable"]);

export const CompatibilityShareConsentQuerySchema = v.object({
  relationshipCategory: v.optional(v.picklist(compatibilityRelationshipCategoryValues)),
});

export const InvalidCompatibilityShareConsentRequestSchema = v.object({
  error: v.literal("Invalid request"),
});

export const CompatibilityShareConsentResponseSchema = v.object({
  displayName: v.nullable(NonEmptyStringSchema),
  avatarUrl: v.nullable(NonEmptyStringSchema),
  canShare: v.boolean(),
  blockingReasons: v.array(CompatibilityShareConsentBlockingReasonSchema),
  nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
});

export const compatibilityShareConsentRoute = describeRoute({
  operationId: "getCompatibilityShareConsent",
  tags: ["Compatibility"],
  summary: "招待発行前に本人の共有可否を確認する",
  security: [{ liffIdToken: [] }],
  parameters: [
    {
      name: "relationshipCategory",
      in: "query",
      required: false,
      schema: { type: "string", enum: [...compatibilityRelationshipCategoryValues] },
      description: "選択した関係カテゴリとgeneralを対象に次の案内を判定する",
    },
  ],
  responses: {
    200: jsonResponse(
      "相手へ表示される表示名と画像path、共有を始められるかどうか",
      CompatibilityShareConsentResponseSchema,
    ),
    400: jsonResponse("関係カテゴリが不正", InvalidCompatibilityShareConsentRequestSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
