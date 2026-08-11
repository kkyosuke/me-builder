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
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { getDevelopmentBrainItems as loadDevelopmentBrainItems } from "../logic/development-brain-items";
import { getDevelopmentBrainVector as loadDevelopmentBrainVector } from "../logic/development-brain-items";
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
