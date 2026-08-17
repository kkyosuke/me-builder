import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  AccountNotFoundErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

export const DevelopmentFailedBrainVectorSyncJobsResponseSchema = v.object({
  jobs: v.array(
    v.object({
      jobId: NonEmptyStringSchema,
      brainItemId: NonEmptyStringSchema,
      itemRevision: CountSchema,
      operation: v.picklist(["upsert", "delete"]),
      attemptCount: CountSchema,
      failureCode: NonEmptyStringSchema,
      failedAt: TimestampSchema,
    }),
  ),
  truncated: v.boolean(),
});

export const ResetDevelopmentBrainVectorSyncJobResponseSchema = v.object({
  reset: v.literal(true),
});

export const ResetAllDevelopmentBrainVectorSyncJobsResponseSchema = v.object({
  resetCount: CountSchema,
});

const DevelopmentRouteNotFoundErrorSchema = v.object({ error: v.literal("Not Found") });
const FailedJobNotFoundErrorSchema = v.object({
  error: v.literal("Failed vector sync job not found"),
});
const DevelopmentOrAccountNotFoundSchema = v.union([
  AccountNotFoundErrorSchema,
  DevelopmentRouteNotFoundErrorSchema,
]);
const DevelopmentAccountOrJobNotFoundSchema = v.union([
  AccountNotFoundErrorSchema,
  DevelopmentRouteNotFoundErrorSchema,
  FailedJobNotFoundErrorSchema,
]);

export const developmentFailedBrainVectorSyncJobsRoute = describeRoute({
  operationId: "listDevelopmentFailedBrainVectorSyncJobs",
  tags: ["Development"],
  summary: "開発環境で本人の終端Brain Vector同期job一覧を取得する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse(
      "本人の終端Brain Vector同期job一覧",
      DevelopmentFailedBrainVectorSyncJobsResponseSchema,
    ),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "開発環境ではない、または対応するAccountがない",
      DevelopmentOrAccountNotFoundSchema,
    ),
  },
} satisfies DescribeRouteOptions);

export const resetDevelopmentBrainVectorSyncJobRoute = describeRoute({
  operationId: "resetDevelopmentBrainVectorSyncJob",
  tags: ["Development"],
  summary: "開発環境で本人の終端Brain Vector同期jobを再試行可能に戻す",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    200: jsonResponse("reset結果", ResetDevelopmentBrainVectorSyncJobResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "開発環境ではない、対応するAccountがない、または指定jobが終端状態ではない",
      DevelopmentAccountOrJobNotFoundSchema,
    ),
  },
} satisfies DescribeRouteOptions);

export const resetAllDevelopmentBrainVectorSyncJobsRoute = describeRoute({
  operationId: "resetAllDevelopmentBrainVectorSyncJobs",
  tags: ["Development"],
  summary: "開発環境で本人の全終端Brain Vector同期jobを再試行可能に戻す",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    200: jsonResponse("resetしたjob件数", ResetAllDevelopmentBrainVectorSyncJobsResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "開発環境ではない、または対応するAccountがない",
      DevelopmentOrAccountNotFoundSchema,
    ),
  },
} satisfies DescribeRouteOptions);
