import {
  compatibilityRelationshipCategoryValues,
  compatibilityRelationshipId,
} from "@me-builder/lib";
import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

export const CompatibilityRelationshipsResponseSchema = v.object({
  items: v.array(
    v.variant("status", [
      v.object({
        relationshipId: compatibilityRelationshipId.schema,
        relationshipCategory: v.picklist(compatibilityRelationshipCategoryValues),
        status: v.literal("pending"),
        expiresAt: v.pipe(v.string(), v.isoTimestamp()),
        invitationUrl: v.pipe(v.string(), v.url()),
      }),
      v.object({
        relationshipId: compatibilityRelationshipId.schema,
        relationshipCategory: v.picklist(compatibilityRelationshipCategoryValues),
        status: v.literal("accepted"),
        partnerDisplayName: v.pipe(v.string(), v.nonEmpty()),
        readiness: v.variant("status", [
          v.object({
            status: v.literal("ready"),
            comparableThemeCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
          }),
          v.object({
            status: v.literal("waiting"),
            nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
          }),
        ]),
      }),
    ]),
  ),
});

export const compatibilityRelationshipsRoute = describeRoute({
  operationId: "listCompatibilityRelationships",
  tags: ["Compatibility"],
  summary: "本人の発行中招待と成立中の相性関係を一覧する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("正本へ同期済みの相性一覧", CompatibilityRelationshipsResponseSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
