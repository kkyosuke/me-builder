import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  AcceptServiceTermsRequestSchema,
  AcceptServiceTermsResponseSchema,
  InvalidServiceTermsRequestSchema,
  ServiceTermsAcceptanceHistoryResponseSchema,
  ServiceTermsStatusResponseSchema,
  ServiceTermsVersionConflictSchema,
} from "../contract/legal/terms";
import { ServiceUnavailableErrorSchema, UnauthorizedErrorSchema } from "../contract/shared/errors";
import {
  acceptServiceTerms,
  getServiceTermsAcceptanceHistory,
  getServiceTermsStatus,
} from "../logic/service-terms";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";

function params(c: Context<AppEnv>) {
  if (!c.env?.DB) return undefined;
  return {
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
  };
}

function unavailable(c: Context<AppEnv>) {
  logger.error({ path: c.req.path }, "Agreement storage binding is not configured");
  return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
}

export async function getServiceTermsContents(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const input = params(c);
  if (!input) return unavailable(c);
  const outcome = await getServiceTermsStatus(input);
  if (outcome.type !== "resolved") {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  return c.json(
    v.parse(ServiceTermsStatusResponseSchema, {
      document: outcome.document,
      acceptance: outcome.acceptance,
    }),
  );
}

export async function putServiceTermsAcceptance(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const input = params(c);
  if (!input) return unavailable(c);
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(AcceptServiceTermsRequestSchema, body);
  if (!parsed.success) {
    return c.json(v.parse(InvalidServiceTermsRequestSchema, { error: "Invalid request" }), 400);
  }
  const outcome = await acceptServiceTerms({ ...input, version: parsed.output.version });
  if (outcome.type === "not-configured" || outcome.type === "unauthenticated") {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  if (outcome.type === "version-conflict") {
    return c.json(
      v.parse(ServiceTermsVersionConflictSchema, {
        error: "Terms version is no longer current",
        currentVersion: outcome.currentVersion,
      }),
      409,
    );
  }
  return c.json(
    v.parse(AcceptServiceTermsResponseSchema, {
      documentKey: outcome.acceptance.documentKey,
      version: outcome.acceptance.documentVersion,
      documentHash: outcome.acceptance.documentHash,
      acceptedAt: outcome.acceptance.acceptedAt,
    }),
  );
}

export async function getServiceTermsAcceptanceHistoryContents(
  c: Context<AppEnv>,
): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const input = params(c);
  if (!input) return unavailable(c);
  const outcome = await getServiceTermsAcceptanceHistory(input);
  if (outcome.type !== "resolved") {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  return c.json(
    v.parse(ServiceTermsAcceptanceHistoryResponseSchema, {
      acceptances: outcome.acceptances,
    }),
  );
}
