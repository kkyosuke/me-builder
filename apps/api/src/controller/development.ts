import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { isDevelopmentEnvironment } from "../config";
import {
  DevelopmentRouteNotFoundErrorSchema,
  ResetDevelopmentAccountDataResponseSchema,
} from "../contract/development/account-data-reset";
import { ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import { resetDevelopmentAccountData } from "../logic/dev-account-data-reset";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

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
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
    conversationCoordinator: c.env.CONVERSATION_COORDINATOR,
  });

  return c.json(v.parse(ResetDevelopmentAccountDataResponseSchema, outcome));
}
