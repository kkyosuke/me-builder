import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, currentTermsPolicyError, jsonResponse } from "../shared/errors";

const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());
const BrainFeatureSchema = v.object({
  category: v.pipe(v.string(), v.nonEmpty()),
  attributes: v.unknown(),
  status: v.picklist(["active", "superseded", "invalidated"]),
  derivation: v.picklist(["ai", "deterministic"]),
  stability: v.pipe(v.string(), v.nonEmpty()),
  sensitivity: v.pipe(v.string(), v.nonEmpty()),
  validFrom: v.nullable(TimestampSchema),
  validTo: v.nullable(TimestampSchema),
  firstObservedAt: TimestampSchema,
  lastObservedAt: TimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const PersonalDataFeaturesResponseSchema = v.object({
  format: v.literal("kagami-brain-features"),
  formatVersion: v.literal(1),
  generatedAt: TimestampSchema,
  scopes: v.tuple([v.literal("attributes"), v.literal("active"), v.literal("history")]),
  brainItems: v.array(BrainFeatureSchema),
});

export const personalDataFeaturesRoute = describeRoute({
  operationId: "getPersonalDataFeatures",
  tags: ["Personal Data"],
  summary: "本人のBrain特徴をAPI連携用に取得する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse(
      "本文・根拠・識別子を含まない本人のBrain特徴",
      PersonalDataFeaturesResponseSchema,
    ),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
