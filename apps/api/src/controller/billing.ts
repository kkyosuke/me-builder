import { D1, billing } from "@me-builder/lib";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  BillingCheckoutRequestSchema,
  BillingInvalidRequestSchema,
  BillingSessionConflictSchema,
  BillingSessionResponseSchema,
} from "../contract/billing/sessions";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { createBillingCheckoutSession } from "../logic/billing-sessions";
import { receiveStripeWebhook } from "../logic/stripe-webhook";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";

export async function postStripeWebhook(c: Context<AppEnv>): Promise<Response> {
  const config = getConfig(c.env);
  const outcome = await receiveStripeWebhook({
    rawBody: await c.req.text(),
    signature: c.req.header("stripe-signature"),
    webhookSecret: config.stripeWebhookSecret,
    provider: config.stripeSecretKey
      ? billing.createStripeBillingProvider({
          secretKey: config.stripeSecretKey,
          ...(config.stripePortalConfigurationId
            ? { portalConfigurationId: config.stripePortalConfigurationId }
            : {}),
        })
      : undefined,
    queue: config.billingQueue,
  });
  switch (outcome.type) {
    case "accepted":
      return c.json({ status: "ok", queued: true });
    case "ignored":
      return c.json({ status: "ok", queued: false });
    case "invalid-signature":
      return c.json({ error: "Invalid webhook" }, 400);
    case "not-configured":
      return c.json({ error: "Service Unavailable" }, 503);
  }
}

export async function postBillingCheckoutSession(c: Context<AppEnv>): Promise<Response> {
  const parsed = v.safeParse(BillingCheckoutRequestSchema, await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(v.parse(BillingInvalidRequestSchema, { error: "Invalid request" }), 400);
  }
  const config = getConfig(c.env);
  if (!c.env?.DB || !config.stripeSecretKey || !config.webOrigin) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const base = {
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    provider: billing.createStripeBillingProvider({ secretKey: config.stripeSecretKey }),
    webOrigin: config.webOrigin,
  };
  const outcome = await createBillingCheckoutSession({
    ...base,
    ...parsed.output,
    lookupKeyMap: config.billingLookupKeyMap,
  });
  switch (outcome.type) {
    case "created":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(BillingSessionResponseSchema, { url: outcome.url }), 201);
    case "unavailable":
      return c.json(
        v.parse(BillingSessionConflictSchema, {
          error: "Billing session unavailable",
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
