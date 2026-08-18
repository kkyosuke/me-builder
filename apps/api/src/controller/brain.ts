import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { isDevelopmentEnvironment } from "../config";
import {
  DevelopmentBrainItemsResponseSchema,
  DevelopmentRouteNotFoundErrorSchema as DevelopmentBrainRouteNotFoundErrorSchema,
  DevelopmentBrainVectorResponseSchema,
} from "../contract/brain/dev-list";
import {
  DevelopmentRouteNotFoundErrorSchema as DevelopmentBrainVectorRouteNotFoundErrorSchema,
  DevelopmentFailedBrainVectorSyncJobsResponseSchema,
  FailedJobNotFoundErrorSchema,
  ResetAllDevelopmentBrainVectorSyncJobsResponseSchema,
  ResetDevelopmentBrainVectorSyncJobResponseSchema,
} from "../contract/brain/dev-vector-sync-jobs";
import { ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import { getDevelopmentBrainItems as loadDevelopmentBrainItems } from "../logic/development-brain-items";
import { getDevelopmentBrainVector as loadDevelopmentBrainVector } from "../logic/development-brain-items";
import {
  listDevelopmentFailedBrainVectorSyncJobs as loadDevelopmentFailedBrainVectorSyncJobs,
  resetAllDevelopmentBrainVectorSyncJobs as resetAllDevelopmentFailedBrainVectorSyncJobs,
  resetDevelopmentBrainVectorSyncJob as resetDevelopmentFailedBrainVectorSyncJob,
} from "../logic/development-brain-vector-sync-jobs";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

/** `GET /api/dev/brain-items` — 開発環境だけで本人のactive Itemを返す。 */
export async function getDevelopmentBrainItems(c: Context<AppEnv>): Promise<Response> {
  const explicitEnvironment = c.env?.ENVIRONMENT?.trim();
  if (!explicitEnvironment || !isDevelopmentEnvironment(explicitEnvironment)) {
    return c.json(v.parse(DevelopmentBrainRouteNotFoundErrorSchema, { error: "Not Found" }), 404);
  }
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Brain Item storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await loadDevelopmentBrainItems({
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
  });

  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(
        v.parse(DevelopmentBrainItemsResponseSchema, {
          items: outcome.items.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
            firstObservedAt: item.firstObservedAt.toISOString(),
            lastObservedAt: item.lastObservedAt.toISOString(),
            vectorSync: {
              ...item.vectorSync,
              ...(item.vectorSync.updatedAt
                ? { updatedAt: item.vectorSync.updatedAt.toISOString() }
                : {}),
              ...(item.vectorSync.nextAttemptAt
                ? { nextAttemptAt: item.vectorSync.nextAttemptAt.toISOString() }
                : {}),
            },
            evidence: item.evidence.map((edge) => ({
              ...edge,
              generatedAt: edge.generatedAt.toISOString(),
              recordedAt: edge.recordedAt.toISOString(),
            })),
          })),
          truncated: outcome.truncated,
        }),
      );
  }
}

/** `GET /api/dev/brain-items/:brainItemId/vector` — Vectorizeの実体を明示操作時だけ照合する。 */
export async function getDevelopmentBrainVector(c: Context<AppEnv>): Promise<Response> {
  const explicitEnvironment = c.env?.ENVIRONMENT?.trim();
  if (!explicitEnvironment || !isDevelopmentEnvironment(explicitEnvironment)) {
    return c.json(v.parse(DevelopmentBrainRouteNotFoundErrorSchema, { error: "Not Found" }), 404);
  }
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.BRAIN_VECTOR_INDEX) {
    logger.error({ path: c.req.path }, "Brain vector storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const brainItemId = c.req.param("brainItemId");
  if (!brainItemId) {
    return c.json(v.parse(DevelopmentBrainRouteNotFoundErrorSchema, { error: "Not Found" }), 404);
  }

  const outcome = await loadDevelopmentBrainVector({
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
    vectorIndex: c.env.BRAIN_VECTOR_INDEX,
    brainItemId,
  });

  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(
        v.parse(DevelopmentBrainVectorResponseSchema, {
          ...outcome.result,
          checkedAt: outcome.result.checkedAt.toISOString(),
        }),
      );
  }
}

function developmentRouteIsAvailable(c: Context<AppEnv>): boolean {
  const explicitEnvironment = c.env?.ENVIRONMENT?.trim();
  return Boolean(explicitEnvironment && isDevelopmentEnvironment(explicitEnvironment));
}

function failedJobParams(c: Context<AppEnv>) {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return undefined;
  return {
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
  };
}

/** `GET /api/dev/brain-vector-sync-jobs/failed` — 本人の終端jobだけを返す。 */
export async function getDevelopmentFailedBrainVectorSyncJobs(
  c: Context<AppEnv>,
): Promise<Response> {
  if (!developmentRouteIsAvailable(c)) {
    return c.json(
      v.parse(DevelopmentBrainVectorRouteNotFoundErrorSchema, { error: "Not Found" }),
      404,
    );
  }
  const params = failedJobParams(c);
  if (!params) {
    logger.error({ path: c.req.path }, "Brain vector sync job storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await loadDevelopmentFailedBrainVectorSyncJobs(params);
  c.header("Cache-Control", "no-store");
  return c.json(
    v.parse(DevelopmentFailedBrainVectorSyncJobsResponseSchema, {
      jobs: outcome.jobs.map((job) => ({ ...job, failedAt: job.failedAt.toISOString() })),
      truncated: outcome.truncated,
    }),
  );
}

/** `POST /api/dev/brain-vector-sync-jobs/:jobId/reset` — 指定した終端jobを戻す。 */
export async function postDevelopmentBrainVectorSyncJobReset(
  c: Context<AppEnv>,
): Promise<Response> {
  if (!developmentRouteIsAvailable(c)) {
    return c.json(
      v.parse(DevelopmentBrainVectorRouteNotFoundErrorSchema, { error: "Not Found" }),
      404,
    );
  }
  const params = failedJobParams(c);
  if (!params) {
    logger.error({ path: c.req.path }, "Brain vector sync job storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const jobId = c.req.param("jobId");
  if (!jobId) {
    return c.json(
      v.parse(DevelopmentBrainVectorRouteNotFoundErrorSchema, { error: "Not Found" }),
      404,
    );
  }
  const outcome = await resetDevelopmentFailedBrainVectorSyncJob({ ...params, jobId });
  if (!outcome.reset) {
    return c.json(
      v.parse(FailedJobNotFoundErrorSchema, { error: "Failed vector sync job not found" }),
      404,
    );
  }
  return c.json(v.parse(ResetDevelopmentBrainVectorSyncJobResponseSchema, { reset: true }));
}

/** `POST /api/dev/brain-vector-sync-jobs/reset-failed` — 本人の全終端jobを戻す。 */
export async function postDevelopmentBrainVectorSyncJobsResetAll(
  c: Context<AppEnv>,
): Promise<Response> {
  if (!developmentRouteIsAvailable(c)) {
    return c.json(
      v.parse(DevelopmentBrainVectorRouteNotFoundErrorSchema, { error: "Not Found" }),
      404,
    );
  }
  const params = failedJobParams(c);
  if (!params) {
    logger.error({ path: c.req.path }, "Brain vector sync job storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await resetAllDevelopmentFailedBrainVectorSyncJobs(params);
  return c.json(
    v.parse(ResetAllDevelopmentBrainVectorSyncJobsResponseSchema, {
      resetCount: outcome.resetCount,
    }),
  );
}
