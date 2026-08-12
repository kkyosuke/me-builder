import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";
import {
  CompatibilitySharePreviewThemeSchema,
  CompatibilityShareProfileSchema,
} from "./share-content";

const PersonSchema = v.object({
  displayName: v.pipe(v.string(), v.nonEmpty()),
  aboutMe: CompatibilityShareProfileSchema,
  themes: v.pipe(v.array(CompatibilitySharePreviewThemeSchema), v.minLength(1)),
});

export const CompatibilityRelationshipResponseSchema = v.variant("status", [
  v.object({
    relationshipId: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
    status: v.literal("ready"),
    partner: PersonSchema,
    viewer: PersonSchema,
  }),
  v.object({
    relationshipId: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
    status: v.literal("waiting"),
    nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
  }),
]);

export const CompatibilityRelationshipUnavailableSchema = v.object({
  error: v.literal("Compatibility relationship unavailable"),
  reason: v.literal("relationship_unavailable"),
});

export const compatibilityRelationshipRoute = describeRoute({
  operationId: "getCompatibilityRelationship",
  tags: ["Compatibility"],
  summary: "成立中の相性関係を双方の現在の内容から組み立てる",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse(
      "相性シート、または比較できるテーマの準備待ち状態",
      CompatibilityRelationshipResponseSchema,
    ),
    ...authenticatedErrors,
    404: jsonResponse(
      "相性関係または対応するAccountを利用できない",
      v.union([
        CompatibilityRelationshipUnavailableSchema,
        v.object({
          error: v.literal("Account not found"),
          reason: v.literal("friendship_required"),
        }),
      ]),
    ),
  },
} satisfies DescribeRouteOptions);
