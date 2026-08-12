import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const PreviewTokenSchema = v.pipe(v.string(), v.regex(/^csp2\.[a-f0-9]{64}$/));

export const IssueCompatibilityInvitationRequestSchema = v.object({
  previewToken: PreviewTokenSchema,
});

export const IssueCompatibilityInvitationResponseSchema = v.object({
  invitationUrl: v.pipe(v.string(), v.url()),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
});

export const InvalidCompatibilityInvitationRequestSchema = v.object({
  error: v.literal("Invalid request"),
});

export const CompatibilityInvitationConflictSchema = v.object({
  error: v.literal("Compatibility invitation unavailable"),
  reason: v.picklist(["preview_changed", "share_unavailable"]),
});

export const issueCompatibilityInvitationRoute = describeRoute({
  operationId: "issueCompatibilityInvitation",
  tags: ["Compatibility"],
  summary: "確認済みの共有内容から1人用の招待リンクを発行する",
  security: [{ liffIdToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: IssueCompatibilityInvitationRequestSchema } },
  },
  responses: {
    201: jsonResponse("発行した招待リンクと有効期限", IssueCompatibilityInvitationResponseSchema),
    400: jsonResponse("リクエストJSONが不正", InvalidCompatibilityInvitationRequestSchema),
    409: jsonResponse(
      "確認後に共有内容が変わった、または現在共有できない",
      CompatibilityInvitationConflictSchema,
    ),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
