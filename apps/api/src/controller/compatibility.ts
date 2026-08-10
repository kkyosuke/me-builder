import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import { CompatibilitySharePreviewResponseSchema } from "../contract/compatibility/share-preview";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { getCompatibilitySharePreview } from "../logic/compatibility-share-preview";
import type { AppEnv } from "../types";

function bearerToken(authorization: string | undefined): string | undefined {
  return authorization?.trim().match(/^Bearer\s+([^\s]+)$/i)?.[1];
}

/** `GET /api/compatibility/share-preview` — 招待発行前に本人へ共有内容を表示する。 */
export async function getCompatibilitySharePreviewContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Compatibility preview storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getCompatibilitySharePreview({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(CompatibilitySharePreviewResponseSchema, outcome.preview));
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
