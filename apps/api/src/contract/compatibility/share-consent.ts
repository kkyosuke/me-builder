import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

const CompatibilityShareConsentBlockingReasonSchema = v.picklist(["display_name_unavailable"]);

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
  responses: {
    200: jsonResponse(
      "相手へ表示される表示名と画像path、共有を始められるかどうか",
      CompatibilityShareConsentResponseSchema,
    ),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
