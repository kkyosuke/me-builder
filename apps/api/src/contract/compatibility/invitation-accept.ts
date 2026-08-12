import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

export const AcceptCompatibilityInvitationResponseSchema = v.object({
  relationshipId: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
  status: v.literal("accepted"),
});

export const CompatibilityInvitationAcceptanceConflictSchema = v.object({
  error: v.literal("Compatibility invitation unavailable"),
  reason: v.picklist(["own_invitation", "share_unavailable", "duplicate_relationship"]),
});

export const acceptCompatibilityInvitationRoute = describeRoute({
  operationId: "acceptCompatibilityInvitation",
  tags: ["Compatibility"],
  summary: "共有へ同意した受信者が相性招待を承諾する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("成立した相性関係", AcceptCompatibilityInvitationResponseSchema),
    ...authenticatedErrors,
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
