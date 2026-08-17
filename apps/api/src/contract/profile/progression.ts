import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, currentTermsPolicyError, jsonResponse } from "../shared/errors";

const NonNegativeIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
const ProgressionChangeSchema = v.object({
  kind: v.picklist(["new_piece", "evidence_deepened", "temporal_change"]),
  growthDelta: v.pipe(v.number(), v.integer(), v.minValue(1)),
  occurredAt: v.pipe(v.string(), v.isoTimestamp()),
});
const MilestoneCardSchema = v.object({
  level: v.pipe(v.number(), v.integer(), v.minValue(10), v.multipleOf(10)),
  reachedAt: v.pipe(v.string(), v.isoTimestamp()),
  collectedPiecesDelta: NonNegativeIntegerSchema,
  categories: v.array(v.string()),
});

export const ProfileProgressionResponseSchema = v.object({
  level: v.pipe(v.number(), v.integer(), v.minValue(1)),
  growthValue: NonNegativeIntegerSchema,
  currentLevelThreshold: NonNegativeIntegerSchema,
  nextLevelThreshold: NonNegativeIntegerSchema,
  collectedPieces: NonNegativeIntegerSchema,
  activePieces: NonNegativeIntegerSchema,
  categoryCount: NonNegativeIntegerSchema,
  calculationVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
  highestLevel: v.pipe(v.number(), v.integer(), v.minValue(1)),
  isProcessing: v.boolean(),
  recentChanges: v.pipe(v.array(ProgressionChangeSchema), v.maxLength(3)),
  milestoneCards: v.pipe(v.array(MilestoneCardSchema), v.maxLength(3)),
});

export const profileProgressionRoute = describeRoute({
  operationId: "getProfileProgression",
  tags: ["Profile"],
  summary: "本人のうつしレベル進行度を取得する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse("本人の累積成長値と現在有効なかけら集計", ProfileProgressionResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
