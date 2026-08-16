import { compatibilityRelationshipCategoryValues } from "@me-builder/lib";
import { type DescribeRouteOptions, describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, currentTermsPolicyError, jsonResponse } from "../shared/errors";

export const IssueCompatibilityInvitationRequestSchema = v.object({
  relationshipCategory: v.picklist(compatibilityRelationshipCategoryValues),
});

export const IssueCompatibilityInvitationResponseSchema = v.object({
  invitationUrl: v.pipe(v.string(), v.url()),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
  relationshipCategory: v.picklist(compatibilityRelationshipCategoryValues),
});

export const InvalidCompatibilityInvitationRequestSchema = v.object({
  error: v.literal("Invalid request"),
});

export const CompatibilityInvitationConflictSchema = v.object({
  error: v.literal("Compatibility invitation unavailable"),
  reason: v.literal("share_unavailable"),
});

export const issueCompatibilityInvitationRequestValidator = validator(
  "json",
  IssueCompatibilityInvitationRequestSchema,
  (result, c) =>
    result.success
      ? undefined
      : c.json(
          v.parse(InvalidCompatibilityInvitationRequestSchema, { error: "Invalid request" }),
          400,
        ),
);

export const issueCompatibilityInvitationRoute = describeRoute({
  operationId: "issueCompatibilityInvitation",
  tags: ["Compatibility"],
  summary: "共有へ同意した本人が1人用の招待リンクを発行する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    201: jsonResponse("発行した招待リンクと有効期限", IssueCompatibilityInvitationResponseSchema),
    400: jsonResponse("関係カテゴリが不正", InvalidCompatibilityInvitationRequestSchema),
    409: jsonResponse("現在は共有を開始できない", CompatibilityInvitationConflictSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
