import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import { AdminStatisticsResponseSchema } from "../contract/admin/statistics";
import {
  AccountNotFoundErrorSchema,
  ForbiddenErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { getAdminStatistics } from "../logic/admin-statistics";
import type { AppEnv } from "../types";

function bearerToken(authorization: string | undefined): string | undefined {
  return authorization?.trim().match(/^Bearer\s+([^\s]+)$/i)?.[1];
}

export async function getStatistics(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const config = getConfig(c.env);
  const outcome = await getAdminStatistics({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    adminLineUserIds: config.adminLineUserIds,
    db: d1.client.create(c.env.DB),
    lineChannelAccessToken: config.lineChannelAccessToken,
  });
  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(AdminStatisticsResponseSchema, outcome.statistics));
    case "forbidden":
      return c.json(v.parse(ForbiddenErrorSchema, { error: "Forbidden" }), 403);
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
