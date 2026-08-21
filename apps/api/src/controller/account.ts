import { D1, billing } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import * as v from "valibot";
import { getConfig } from "../config";
import { DeleteAccountRequestSchema, InvalidDeleteAccountRequestSchema } from "../contract/account";
import { ForbiddenErrorSchema, ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import { APPLICATION_SESSION_COOKIE } from "../infrastructure/authentication/application-session-runtime";
import { deleteOwnAccount } from "../logic/account-deletion";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";
import { hasRecentAuthentication } from "./development-access";

/** `DELETE /api/account` — 現行規約への同意有無に関係なく本人のAccountを削除する。 */
export async function deleteAccount(c: Context<AppEnv>): Promise<Response> {
  const request = v.safeParse(
    DeleteAccountRequestSchema,
    await c.req.json().catch(() => undefined),
  );
  if (!request.success) {
    return c.json(v.parse(InvalidDeleteAccountRequestSchema, { error: "Invalid request" }), 400);
  }
  if (!hasRecentAuthentication(c)) {
    return c.json(v.parse(ForbiddenErrorSchema, { error: "Forbidden" }), 403);
  }
  if (
    !c.env?.DB ||
    !c.env.ACCOUNT_DATA ||
    !c.env.COMPATIBILITY_DATA ||
    !c.env.CONVERSATION_COORDINATOR
  ) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const config = getConfig(c.env);
  const db = D1.shared.client.create(c.env.DB);
  const billingCustomer = await D1.shared.action.billing.findBillingCustomerByAccount(
    db,
    authenticatedActor(c).accountId,
  );
  if (billingCustomer && !config.stripeSecretKey) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await deleteOwnAccount({
    actor: authenticatedActor(c),
    db,
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
    conversationCoordinator: c.env.CONVERSATION_COORDINATOR,
    ...(config.stripeSecretKey
      ? {
          billingProvider: billing.createStripeBillingProvider({
            secretKey: config.stripeSecretKey,
          }),
        }
      : {}),
    deleteAvatarObject: async (objectKey) => {
      if (!c.env.AVATAR_BUCKET) throw new Error("Avatar bucket is required for Account deletion");
      await c.env.AVATAR_BUCKET.delete(objectKey);
    },
  });
  deleteCookie(c, APPLICATION_SESSION_COOKIE, {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  });
  c.header("Cache-Control", "no-store");
  logger.info(
    {
      event: "account.deleted",
      outcome: "succeeded",
      scheduledVectorDeletionCount: outcome.scheduledVectorDeletionCount,
    },
    "Account and personal data were deleted",
  );
  return c.body(null, 204);
}
