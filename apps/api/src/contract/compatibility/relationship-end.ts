import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  authenticatedErrors,
  csrfValidationError,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

export const compatibilityRelationshipEndRoute = describeRoute({
  operationId: "endCompatibilityRelationship",
  tags: ["Compatibility"],
  summary: "当事者が成立中の相性関係を終了する",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    204: { description: "相性関係を終了した" },
    ...csrfValidationError,
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "相性関係または対応するAccountを利用できない",
      v.union([
        v.object({
          error: v.literal("Compatibility relationship unavailable"),
          reason: v.literal("relationship_unavailable"),
        }),
        v.object({
          error: v.literal("Account not found"),
          reason: v.literal("friendship_required"),
        }),
      ]),
    ),
  },
} satisfies DescribeRouteOptions);
