import { type DescribeRouteOptions, describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const PreviewTokenSchema = v.pipe(v.string(), v.regex(/^csp2\.[a-f0-9]{64}$/));

export const AcceptCompatibilityInvitationRequestSchema = v.object({
  previewToken: PreviewTokenSchema,
});

export const AcceptCompatibilityInvitationResponseSchema = v.object({
  relationshipId: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
  status: v.literal("accepted"),
});

export const InvalidCompatibilityInvitationAcceptanceSchema = v.object({
  error: v.literal("Invalid request"),
});

export const CompatibilityInvitationAcceptanceConflictSchema = v.object({
  error: v.literal("Compatibility invitation unavailable"),
  reason: v.picklist([
    "own_invitation",
    "preview_changed",
    "share_unavailable",
    "duplicate_relationship",
  ]),
});

export const acceptCompatibilityInvitationValidator = validator(
  "json",
  AcceptCompatibilityInvitationRequestSchema,
  (result, c) => {
    if (!result.success) return c.json({ error: "Invalid request" } as const, 400);
  },
);

export const acceptCompatibilityInvitationRoute = describeRoute({
  operationId: "acceptCompatibilityInvitation",
  tags: ["Compatibility"],
  summary: "確認済みの共有内容で相性招待を承諾する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("成立した相性関係", AcceptCompatibilityInvitationResponseSchema),
    ...authenticatedErrors,
    400: jsonResponse("リクエストJSONが不正", InvalidCompatibilityInvitationAcceptanceSchema),
    404: jsonResponse(
      "招待または対応するAccountを利用できない",
      v.object({
        error: v.picklist(["Compatibility invitation unavailable", "Account not found"]),
        reason: v.picklist(["invitation_unavailable", "friendship_required"]),
      }),
    ),
    409: jsonResponse("招待を現在承諾できない", CompatibilityInvitationAcceptanceConflictSchema),
  },
} satisfies DescribeRouteOptions);
