import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig, isDevelopmentEnvironment } from "../config";
import {
  DevelopmentRouteNotFoundErrorSchema,
  ResetDevelopmentAccountDataResponseSchema,
} from "../contract/development/account-data-reset";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { resetDevelopmentAccountData } from "../logic/dev-account-data-reset";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";

/** `DELETE /api/dev/account-data` — 開発環境で本人の個人コンテンツを全削除する。 */
export async function deleteDevelopmentAccountData(c: Context<AppEnv>): Promise<Response> {
  const explicitEnvironment = c.env?.ENVIRONMENT?.trim();
  if (!explicitEnvironment || !isDevelopmentEnvironment(explicitEnvironment)) {
    return c.json(v.parse(DevelopmentRouteNotFoundErrorSchema, { error: "Not Found" }), 404);
  }
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.CONVERSATION_COORDINATOR) {
    logger.error({ path: c.req.path }, "Development account data reset binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await resetDevelopmentAccountData({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    conversationCoordinator: c.env.CONVERSATION_COORDINATOR,
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(ResetDevelopmentAccountDataResponseSchema, outcome));
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
