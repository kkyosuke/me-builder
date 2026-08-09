import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { AccountNotFoundErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

export const DevelopmentBrainItemsResponseSchema = v.object({
  items: v.array(
    v.object({
      id: NonEmptyStringSchema,
      category: NonEmptyStringSchema,
      statement: NonEmptyStringSchema,
      derivation: v.picklist(["ai", "deterministic"]),
      status: v.literal("active"),
      createdAt: v.pipe(v.string(), v.isoTimestamp()),
      evidence: v.array(
        v.object({
          sourceRecordId: NonEmptyStringSchema,
          relation: v.picklist(["supports", "contradicts"]),
          derivationMethod: v.picklist(["ai", "deterministic"]),
          generatedAt: v.pipe(v.string(), v.isoTimestamp()),
        }),
      ),
    }),
  ),
  truncated: v.boolean(),
});

const DevelopmentRouteNotFoundErrorSchema = v.object({ error: v.literal("Not Found") });

export const developmentBrainItemsRoute = describeRoute({
  operationId: "getDevelopmentBrainItems",
  tags: ["Development"],
  summary: "開発環境で本人のactive Brain Item一覧を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("本人のactive Brain ItemとEvidence", DevelopmentBrainItemsResponseSchema),
    ...authenticatedErrors,
    404: jsonResponse(
      "開発環境ではない、または対応するAccountがない",
      v.union([AccountNotFoundErrorSchema, DevelopmentRouteNotFoundErrorSchema]),
    ),
  },
} satisfies DescribeRouteOptions);
