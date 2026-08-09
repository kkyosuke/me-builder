import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import { DevelopmentBrainItemsResponseSchema } from "../contract/brain/dev-list";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { getDevelopmentBrainItems as loadDevelopmentBrainItems } from "../logic/development-brain-items";
import type { AppEnv } from "../types";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

function bearerToken(authorization: string | undefined): string | undefined {
  return authorization?.trim().match(/^Bearer\s+([^\s]+)$/i)?.[1];
}

/** `GET /api/dev/brain-items` — 開発環境だけで本人のactive Itemを返す。 */
export async function getDevelopmentBrainItems(c: Context<AppEnv>): Promise<Response> {
  const config = getConfig(c.env);
  if (!DEVELOPMENT_ENVIRONMENTS.has(config.environment)) {
    return c.json({ error: "Not Found" } as const, 404);
  }
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Brain Item storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await loadDevelopmentBrainItems({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    db: d1.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(
        v.parse(DevelopmentBrainItemsResponseSchema, {
          items: outcome.items.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
            evidence: item.evidence.map((edge) => ({
              ...edge,
              generatedAt: edge.generatedAt.toISOString(),
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
