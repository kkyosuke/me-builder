import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

export const compatibilityInvitationCancelRoute = describeRoute({
  operationId: "cancelCompatibilityInvitation",
  tags: ["Compatibility"],
  summary: "本人が発行中の相性招待を取り消す",
  security: [{ liffIdToken: [] }],
  responses: {
    204: { description: "招待を取り消した" },
    ...authenticatedErrors,
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
