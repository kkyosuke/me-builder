import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  AccountNotFoundErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

const VectorSyncSchema = v.object({
  status: v.picklist([
    "pending",
    "submitted",
    "retry_scheduled",
    "applied",
    "failed",
    "not-scheduled",
  ]),
  operation: v.optional(v.picklist(["upsert", "delete"])),
  attemptCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  updatedAt: v.optional(TimestampSchema),
  nextAttemptAt: v.optional(TimestampSchema),
  failureCode: v.optional(NonEmptyStringSchema),
  hasEntry: v.boolean(),
  entryRevision: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
});

export const DevelopmentBrainItemsResponseSchema = v.object({
  items: v.array(
    v.object({
      id: NonEmptyStringSchema,
      category: NonEmptyStringSchema,
      statement: NonEmptyStringSchema,
      derivation: v.picklist(["ai", "deterministic"]),
      status: v.literal("active"),
      createdAt: TimestampSchema,
      firstObservedAt: TimestampSchema,
      lastObservedAt: TimestampSchema,
      vectorSync: VectorSyncSchema,
      evidence: v.array(
        v.object({
          sourceRecordId: NonEmptyStringSchema,
          relation: v.picklist(["supports", "contradicts"]),
          derivationMethod: v.picklist(["ai", "deterministic"]),
          generatedAt: v.pipe(v.string(), v.isoTimestamp()),
          recordedAt: TimestampSchema,
        }),
      ),
    }),
  ),
  truncated: v.boolean(),
});

const DevelopmentBrainVectorMetadataSchema = v.object({
  category: v.optional(NonEmptyStringSchema),
  derivation: v.optional(v.picklist(["ai", "deterministic"])),
  embeddingVersion: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
  schemaVersion: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
});

export const DevelopmentBrainVectorResponseSchema = v.variant("state", [
  v.object({ state: v.literal("not-synced"), checkedAt: TimestampSchema }),
  v.object({
    state: v.literal("missing"),
    entryRevision: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    checkedAt: TimestampSchema,
  }),
  v.object({
    state: v.literal("present"),
    entryRevision: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    dimensions: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    metadata: DevelopmentBrainVectorMetadataSchema,
    checkedAt: TimestampSchema,
  }),
]);

export const DevelopmentRouteNotFoundErrorSchema = v.object({ error: v.literal("Not Found") });

export const developmentBrainItemsRoute = describeRoute({
  operationId: "getDevelopmentBrainItems",
  tags: ["Development"],
  summary: "開発環境で本人のactive Brain Item一覧を取得する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse("本人のactive Brain ItemとEvidence", DevelopmentBrainItemsResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "開発環境ではない、または対応するAccountがない",
      v.union([AccountNotFoundErrorSchema, DevelopmentRouteNotFoundErrorSchema]),
    ),
  },
} satisfies DescribeRouteOptions);

export const developmentBrainVectorRoute = describeRoute({
  operationId: "getDevelopmentBrainVector",
  tags: ["Development"],
  summary: "開発環境で本人のBrain Itemに対応するVectorize実体を確認する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse(
      "AccountDataの対応表とVectorize実体の照合結果",
      DevelopmentBrainVectorResponseSchema,
    ),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "開発環境ではない、または対応するAccountがない",
      v.union([AccountNotFoundErrorSchema, DevelopmentRouteNotFoundErrorSchema]),
    ),
  },
} satisfies DescribeRouteOptions);
