import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import { getSurveyList } from "../logic/survey-list";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  SurveyListResponseSchema,
  UnauthorizedErrorSchema,
} from "../openapi";
import type { AppEnv } from "../types";

function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.trim().match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

/** `GET /api/surveys` — 回答進捗を含む、表示可能なアンケート一覧を返す。 */
export async function getSurveys(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getSurveyList({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: d1.client.create(c.env.DB),
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(SurveyListResponseSchema, { surveys: outcome.surveys }));
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
