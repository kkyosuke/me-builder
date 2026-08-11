import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  ProfileSummaryGenerationAcceptedSchema,
  ProfileSummaryGenerationUnavailableSchema,
  ProfileSummaryResponseSchema,
} from "../contract/profile/summary";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { getProfileSummary } from "../logic/profile-summary";
import { requestProfileSummaryGeneration } from "../logic/profile-summary-generation";
import type { AppEnv } from "../types";

function bearerToken(authorization: string | undefined): string | undefined {
  return authorization?.trim().match(/^Bearer\s+([^\s]+)$/i)?.[1];
}

export async function getProfileSummaryContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Profile storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getProfileSummary({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(
        v.parse(ProfileSummaryResponseSchema, {
          versions: outcome.versions,
          availableDataCounts: outcome.availableDataCounts,
          generation: outcome.generation,
          nextAction: outcome.nextAction,
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

export async function postProfileSummaryGeneration(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.PROFILE_SUMMARY_QUEUE) {
    logger.error({ path: c.req.path }, "Profile Summary generation binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await requestProfileSummaryGeneration({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    queue: c.env.PROFILE_SUMMARY_QUEUE,
  });
  switch (outcome.type) {
    case "accepted":
      return c.json(v.parse(ProfileSummaryGenerationAcceptedSchema, outcome), 202);
    case "unavailable":
      return c.json(
        v.parse(ProfileSummaryGenerationUnavailableSchema, {
          error: "Profile summary generation unavailable",
          reason: outcome.reason,
        }),
        409,
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
