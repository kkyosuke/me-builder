import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

export const IssueCompatibilityInvitationResponseSchema = v.object({
  invitationUrl: v.pipe(v.string(), v.url()),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
});

export const CompatibilityInvitationConflictSchema = v.object({
  error: v.literal("Compatibility invitation unavailable"),
  reason: v.literal("share_unavailable"),
});

export const issueCompatibilityInvitationRoute = describeRoute({
  operationId: "issueCompatibilityInvitation",
  tags: ["Compatibility"],
  summary: "共有へ同意した本人が1人用の招待リンクを発行する",
  security: [{ liffIdToken: [] }],
  responses: {
    201: jsonResponse("発行した招待リンクと有効期限", IssueCompatibilityInvitationResponseSchema),
    409: jsonResponse("現在は共有を開始できない", CompatibilityInvitationConflictSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
