import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, currentTermsPolicyError, jsonResponse } from "../shared/errors";

export const compatibilityInvitationCancelRoute = describeRoute({
  operationId: "cancelCompatibilityInvitation",
  tags: ["Compatibility"],
  summary: "本人が発行中の相性招待を取り消す",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    204: { description: "招待を取り消した" },
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "招待または対応するAccountを利用できない",
      v.union([
        v.object({
          error: v.literal("Compatibility invitation unavailable"),
          reason: v.literal("invitation_unavailable"),
        }),
        v.object({
          error: v.literal("Account not found"),
          reason: v.literal("friendship_required"),
        }),
      ]),
    ),
  },
} satisfies DescribeRouteOptions);
