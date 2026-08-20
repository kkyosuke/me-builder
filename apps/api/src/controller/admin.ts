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
import { AdminBillingHealthResponseSchema } from "../contract/admin/billing-health";
import {
  AdminBillingReconciliationRequestSchema,
  AdminBillingReconciliationResponseSchema,
  BillingCustomerNotFoundSchema,
  BillingReconciliationUnavailableSchema,
  InvalidBillingReconciliationSchema,
} from "../contract/admin/billing-reconciliation";
import { AdminStatisticsResponseSchema } from "../contract/admin/statistics";
import { ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import { getAdminAccounts } from "../logic/admin-accounts";
import { getAdminBillingHealth } from "../logic/admin-billing-health";
import { reconcileAdminBillingProjection } from "../logic/admin-billing-reconciliation";
import { getAdminStatistics } from "../logic/admin-statistics";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

export async function getAccounts(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const parsed = v.safeParse(AdminAccountsQuerySchema, c.req.query());
  if (!parsed.success) {
    return c.json(v.parse(InvalidAdminAccountsRequestSchema, { error: "Invalid request" }), 400);
  }
  const outcome = await getAdminAccounts({
    actor: authenticatedActor(c),
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
  }
}

export async function getStatistics(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const config = getConfig(c.env);
  const outcome = await getAdminStatistics({
    actor: authenticatedActor(c),
    db: D1.shared.client.create(c.env.DB),
    lineChannelAccessToken: config.lineChannelAccessToken,
  });
  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(AdminStatisticsResponseSchema, outcome.statistics));
  }
}

export async function postBillingReconciliation(c: Context<AppEnv>): Promise<Response> {
  const config = getConfig(c.env);
  if (config.environment !== "preview") {
    return c.json(v.parse(BillingReconciliationUnavailableSchema, { error: "Not Found" }), 404);
  }
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
  if (parsed.output.mode === "apply" && parsed.output.confirmed !== true) {
    return c.json(v.parse(InvalidBillingReconciliationSchema, { error: "Invalid request" }), 400);
  }
  if (!config.stripeSecretKey) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await reconcileAdminBillingProjection({
    actor: authenticatedActor(c),
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
  }
}

export async function getBillingHealth(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const config = getConfig(c.env);
  const outcome = await getAdminBillingHealth({
    actor: authenticatedActor(c),
    db: D1.shared.client.create(c.env.DB),
    staleAfterMs: config.billingProjectionStaleAfterSeconds * 1_000,
  });
  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(AdminBillingHealthResponseSchema, outcome.health));
  }
}
