import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import {
  DevelopmentRouteNotFoundErrorSchema,
  InvalidDevelopmentResetRequestSchema,
  ResetDevelopmentAccountDataRequestSchema,
  ResetDevelopmentAccountDataResponseSchema,
} from "../contract/development/account-data-reset";
import { ForbiddenErrorSchema, ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import { resetDevelopmentAccountData } from "../logic/dev-account-data-reset";
import { recordDevelopmentOperationAudit } from "../logic/development-operation-audit";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";
import {
  developmentAdminRouteIsAvailable,
  hasRecentDevelopmentAuthentication,
} from "./development-access";

/** `DELETE /api/dev/account-data` — 開発環境で本人の個人コンテンツを全削除する。 */
export async function deleteDevelopmentAccountData(c: Context<AppEnv>): Promise<Response> {
  if (!developmentAdminRouteIsAvailable(c)) {
    return c.json(v.parse(DevelopmentRouteNotFoundErrorSchema, { error: "Not Found" }), 404);
  }
  const request = v.safeParse(
    ResetDevelopmentAccountDataRequestSchema,
    await c.req.json().catch(() => undefined),
  );
  if (!request.success) {
    return c.json(v.parse(InvalidDevelopmentResetRequestSchema, { error: "Invalid request" }), 400);
  }
  if (!hasRecentDevelopmentAuthentication(c)) {
    return c.json(v.parse(ForbiddenErrorSchema, { error: "Forbidden" }), 403);
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
  const deletedContentCount =
    outcome.deletedDiagnosisResponseCount +
    outcome.deletedConversationSessionCount +
    outcome.deletedSourceRecordCount +
    outcome.deletedBrainItemCount +
    outcome.deletedProfileSummaryVersionCount;
  await recordDevelopmentOperationAudit(c.env.DB, "account-data-reset", deletedContentCount);

  logger.info(
    {
      event: "development.account-data.reset",
      outcome: "succeeded",
      deletedContentCount,
      scheduledVectorDeletionCount: outcome.scheduledVectorDeletionCount,
    },
    "Development Account data was reset",
  );

  return c.json(v.parse(ResetDevelopmentAccountDataResponseSchema, outcome));
}
