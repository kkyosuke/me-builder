import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig, isDevelopmentEnvironment } from "../config";
import {
  DevelopmentBrainItemsResponseSchema,
  DevelopmentBrainVectorResponseSchema,
} from "../contract/brain/dev-list";
import {
  DevelopmentFailedBrainVectorSyncJobsResponseSchema,
  ResetAllDevelopmentBrainVectorSyncJobsResponseSchema,
  ResetDevelopmentBrainVectorSyncJobResponseSchema,
} from "../contract/brain/dev-vector-sync-jobs";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { getDevelopmentBrainItems as loadDevelopmentBrainItems } from "../logic/development-brain-items";
import { getDevelopmentBrainVector as loadDevelopmentBrainVector } from "../logic/development-brain-items";
import {
  listDevelopmentFailedBrainVectorSyncJobs as loadDevelopmentFailedBrainVectorSyncJobs,
  resetAllDevelopmentBrainVectorSyncJobs as resetAllDevelopmentFailedBrainVectorSyncJobs,
  resetDevelopmentBrainVectorSyncJob as resetDevelopmentFailedBrainVectorSyncJob,
} from "../logic/development-brain-vector-sync-jobs";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";

/** `GET /api/dev/brain-items` — 開発環境だけで本人のactive Itemを返す。 */
export async function getDevelopmentBrainItems(c: Context<AppEnv>): Promise<Response> {
  const explicitEnvironment = c.env?.ENVIRONMENT?.trim();
  if (!explicitEnvironment || !isDevelopmentEnvironment(explicitEnvironment)) {
    return c.json({ error: "Not Found" } as const, 404);
  }
  const config = getConfig(c.env);
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Brain Item storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await loadDevelopmentBrainItems({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
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
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `GET /api/dev/brain-items/:brainItemId/vector` — Vectorizeの実体を明示操作時だけ照合する。 */
export async function getDevelopmentBrainVector(c: Context<AppEnv>): Promise<Response> {
  const explicitEnvironment = c.env?.ENVIRONMENT?.trim();
  if (!explicitEnvironment || !isDevelopmentEnvironment(explicitEnvironment)) {
    return c.json({ error: "Not Found" } as const, 404);
  }
  const config = getConfig(c.env);
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.BRAIN_VECTOR_INDEX) {
    logger.error({ path: c.req.path }, "Brain vector storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const brainItemId = c.req.param("brainItemId");
  if (!brainItemId) return c.json({ error: "Not Found" } as const, 404);

  const outcome = await loadDevelopmentBrainVector({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
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
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

function developmentRouteIsAvailable(c: Context<AppEnv>): boolean {
  const explicitEnvironment = c.env?.ENVIRONMENT?.trim();
  return Boolean(explicitEnvironment && isDevelopmentEnvironment(explicitEnvironment));
}

function failedJobParams(c: Context<AppEnv>) {
  const config = getConfig(c.env);
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return undefined;
  return {
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
  };
}

function sessionFailureResponse(
  c: Context<AppEnv>,
  outcome: { type: "not-configured" } | { type: "unauthenticated" } | { type: "account-not-found" },
) {
  if (outcome.type === "account-not-found") {
    return c.json(
      v.parse(AccountNotFoundErrorSchema, {
        error: "Account not found",
        reason: "friendship_required",
      }),
      404,
    );
  }
  return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
}

/** `GET /api/dev/brain-vector-sync-jobs/failed` — 本人の終端jobだけを返す。 */
export async function getDevelopmentFailedBrainVectorSyncJobs(
  c: Context<AppEnv>,
): Promise<Response> {
  if (!developmentRouteIsAvailable(c)) return c.json({ error: "Not Found" } as const, 404);
  const params = failedJobParams(c);
  if (!params) {
    logger.error({ path: c.req.path }, "Brain vector sync job storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await loadDevelopmentFailedBrainVectorSyncJobs(params);
  if (outcome.type !== "resolved") return sessionFailureResponse(c, outcome);
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
  if (!developmentRouteIsAvailable(c)) return c.json({ error: "Not Found" } as const, 404);
  const params = failedJobParams(c);
  if (!params) {
    logger.error({ path: c.req.path }, "Brain vector sync job storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const jobId = c.req.param("jobId");
  if (!jobId) return c.json({ error: "Not Found" } as const, 404);
  const outcome = await resetDevelopmentFailedBrainVectorSyncJob({ ...params, jobId });
  if (outcome.type !== "resolved") return sessionFailureResponse(c, outcome);
  if (!outcome.reset) return c.json({ error: "Failed vector sync job not found" } as const, 404);
  return c.json(v.parse(ResetDevelopmentBrainVectorSyncJobResponseSchema, { reset: true }));
}

/** `POST /api/dev/brain-vector-sync-jobs/reset-failed` — 本人の全終端jobを戻す。 */
export async function postDevelopmentBrainVectorSyncJobsResetAll(
  c: Context<AppEnv>,
): Promise<Response> {
  if (!developmentRouteIsAvailable(c)) return c.json({ error: "Not Found" } as const, 404);
  const params = failedJobParams(c);
  if (!params) {
    logger.error({ path: c.req.path }, "Brain vector sync job storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await resetAllDevelopmentFailedBrainVectorSyncJobs(params);
  if (outcome.type !== "resolved") return sessionFailureResponse(c, outcome);
  return c.json(
    v.parse(ResetAllDevelopmentBrainVectorSyncJobsResponseSchema, {
      resetCount: outcome.resetCount,
    }),
  );
}
