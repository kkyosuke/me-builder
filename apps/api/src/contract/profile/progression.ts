import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const NonNegativeIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(0));

export const ProfileProgressionResponseSchema = v.object({
  level: v.pipe(v.number(), v.integer(), v.minValue(1)),
  growthValue: NonNegativeIntegerSchema,
  currentLevelThreshold: NonNegativeIntegerSchema,
  nextLevelThreshold: NonNegativeIntegerSchema,
  collectedPieces: NonNegativeIntegerSchema,
  activePieces: NonNegativeIntegerSchema,
  categoryCount: NonNegativeIntegerSchema,
});

export const profileProgressionRoute = describeRoute({
  operationId: "getProfileProgression",
  tags: ["Profile"],
  summary: "本人のうつしレベル進行度を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("本人の累積成長値と現在有効なかけら集計", ProfileProgressionResponseSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
