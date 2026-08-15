import { D1, billing } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  AdminAccountsQuerySchema,
  AdminAccountsResponseSchema,
  InvalidAdminAccountsRequestSchema,
} from "../contract/admin/accounts";
import {
  AdminBillingReconciliationRequestSchema,
  AdminBillingReconciliationResponseSchema,
  BillingCustomerNotFoundSchema,
  InvalidBillingReconciliationSchema,
} from "../contract/admin/billing-reconciliation";
import { AdminStatisticsResponseSchema } from "../contract/admin/statistics";
import {
  AccountNotFoundErrorSchema,
  ForbiddenErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { getAdminAccounts } from "../logic/admin-accounts";
import { reconcileAdminBillingProjection } from "../logic/admin-billing-reconciliation";
import { getAdminStatistics } from "../logic/admin-statistics";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";

export async function getAccounts(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const parsed = v.safeParse(AdminAccountsQuerySchema, c.req.query());
  if (!parsed.success) {
    return c.json(v.parse(InvalidAdminAccountsRequestSchema, { error: "Invalid request" }), 400);
  }
  const config = getConfig(c.env);
  const outcome = await getAdminAccounts({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    adminLineUserIds: config.adminLineUserIds,
    db: D1.shared.client.create(c.env.DB),
    input: {
      ...(parsed.output.query !== undefined ? { query: parsed.output.query } : {}),
      ...(parsed.output.role !== undefined ? { role: parsed.output.role } : {}),
      ...(parsed.output.status !== undefined ? { status: parsed.output.status } : {}),
      ...(parsed.output.sort !== undefined ? { sort: parsed.output.sort } : {}),
      ...(parsed.output.cursor !== undefined ? { cursor: parsed.output.cursor } : {}),
    },
  });
  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(AdminAccountsResponseSchema, outcome.page));
    case "invalid-request":
      return c.json(v.parse(InvalidAdminAccountsRequestSchema, { error: "Invalid request" }), 400);
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
    db: D1.shared.client.create(c.env.DB),
    lineChannelAccessToken: config.lineChannelAccessToken,
  });
  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
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

export async function postBillingReconciliation(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const parsed = v.safeParse(
    AdminBillingReconciliationRequestSchema,
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json(v.parse(InvalidBillingReconciliationSchema, { error: "Invalid request" }), 400);
  }
  const config = getConfig(c.env);
  if (!config.stripeSecretKey) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await reconcileAdminBillingProjection({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    adminLineUserIds: config.adminLineUserIds,
    db: D1.shared.client.create(c.env.DB),
    provider: billing.createStripeBillingProvider({
      secretKey: config.stripeSecretKey,
      ...(config.stripePortalConfigurationId
        ? { portalConfigurationId: config.stripePortalConfigurationId }
        : {}),
    }),
    accountId: parsed.output.accountId,
    mode: parsed.output.mode,
    pricePlanMap: config.billingPricePlanMap,
  });
  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(AdminBillingReconciliationResponseSchema, outcome.reconciliation));
    case "customer-not-found":
      return c.json(
        v.parse(BillingCustomerNotFoundSchema, { error: "Billing customer not found" }),
        404,
      );
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
