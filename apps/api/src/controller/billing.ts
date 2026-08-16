import { D1, billing } from "@me-builder/lib";
import { BILLING_INITIAL_TRIAL_DAYS, publicBillingPlans } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  BillingCheckoutRequestSchema,
  BillingCheckoutSessionIdSchema,
  BillingCheckoutSessionNotFoundSchema,
  BillingCheckoutSessionStatusResponseSchema,
  BillingInvalidRequestSchema,
  BillingPlanCatalogResponseSchema,
  BillingSessionConflictSchema,
  BillingSessionResponseSchema,
  BillingTrialEligibilityResponseSchema,
} from "../contract/billing/sessions";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import {
  createBillingCheckoutSession,
  createBillingPlanChangeSession,
  createBillingPortalSession,
  getBillingCheckoutSessionStatus,
  getBillingTrialEligibility,
} from "../logic/billing-sessions";
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

export function getBillingPlanCatalog(c: Context<AppEnv>): Response {
  return c.json(
    v.parse(BillingPlanCatalogResponseSchema, {
      plans: publicBillingPlans.map(
        ({ code, name, description, highlights, trialDays, prices }) => ({
          code,
          name,
          description,
          highlights: [...highlights],
          trialDays,
          prices: prices.map(({ interval, amount, currency }) => ({ interval, amount, currency })),
        }),
      ),
    }),
  );
}

export async function getBillingTrialEligibilityResponse(c: Context<AppEnv>): Promise<Response> {
  const config = getConfig(c.env);
  if (!c.env?.DB || !config.stripeSecretKey || !config.lineLoginChannelId) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await getBillingTrialEligibility({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    provider: billing.createStripeBillingProvider({ secretKey: config.stripeSecretKey }),
  });
  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(
        v.parse(BillingTrialEligibilityResponseSchema, {
          eligible: outcome.eligible,
          trialDays: BILLING_INITIAL_TRIAL_DAYS,
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

export async function postBillingCheckoutSession(c: Context<AppEnv>): Promise<Response> {
  const parsed = v.safeParse(BillingCheckoutRequestSchema, await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(v.parse(BillingInvalidRequestSchema, { error: "Invalid request" }), 400);
  }
  return createBillingSessionResponse(c, "checkout", parsed.output);
}

export async function postBillingPlanChangeSession(c: Context<AppEnv>): Promise<Response> {
  const parsed = v.safeParse(BillingCheckoutRequestSchema, await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(v.parse(BillingInvalidRequestSchema, { error: "Invalid request" }), 400);
  }
  return createBillingSessionResponse(c, "change", parsed.output);
}

export async function postBillingPortalSession(c: Context<AppEnv>): Promise<Response> {
  return createBillingSessionResponse(c, "portal");
}

export async function getBillingCheckoutSession(c: Context<AppEnv>): Promise<Response> {
  const checkoutSessionId = v.safeParse(
    BillingCheckoutSessionIdSchema,
    c.req.param("checkoutSessionId") ?? "",
  );
  if (!checkoutSessionId.success) {
    return c.json(
      v.parse(BillingCheckoutSessionNotFoundSchema, { error: "Checkout session not found" }),
      404,
    );
  }
  const config = getConfig(c.env);
  if (!c.env?.DB || !config.stripeSecretKey || !config.webOrigin) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await getBillingCheckoutSessionStatus({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    provider: billing.createStripeBillingProvider({ secretKey: config.stripeSecretKey }),
    webOrigin: config.webOrigin,
    checkoutSessionId: checkoutSessionId.output,
  });
  switch (outcome.type) {
    case "found":
      c.header("Cache-Control", "no-store");
      return c.json(
        v.parse(BillingCheckoutSessionStatusResponseSchema, { status: outcome.status }),
      );
    case "not-found":
      return c.json(
        v.parse(BillingCheckoutSessionNotFoundSchema, { error: "Checkout session not found" }),
        404,
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

async function createBillingSessionResponse(
  c: Context<AppEnv>,
  kind: "checkout" | "portal" | "change",
  checkout?: v.InferOutput<typeof BillingCheckoutRequestSchema>,
): Promise<Response> {
  const config = getConfig(c.env);
  const completeLookupKeyMap = publicBillingPlans.every((plan) =>
    plan.prices.every(({ interval }) =>
      Boolean(config.billingLookupKeyMap[`${plan.code}.${interval}`]),
    ),
  );
  const kindConfigurationAvailable =
    kind === "portal"
      ? Boolean(config.stripePortalConfigurationId)
      : kind === "change"
        ? Boolean(
            config.stripePortalPlanChangeConfigurationId &&
              config.stripePortalResetConfigurationId &&
              completeLookupKeyMap,
          )
        : completeLookupKeyMap;
  if (
    !c.env?.DB ||
    !config.stripeSecretKey ||
    !config.webOrigin ||
    !config.lineLoginChannelId ||
    !kindConfigurationAvailable
  ) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const base = {
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    provider: billing.createStripeBillingProvider({
      secretKey: config.stripeSecretKey,
      ...(config.stripePortalConfigurationId
        ? { portalConfigurationId: config.stripePortalConfigurationId }
        : {}),
      ...(config.stripePortalResetConfigurationId
        ? { portalResetConfigurationId: config.stripePortalResetConfigurationId }
        : {}),
      ...(config.stripePortalPlanChangeConfigurationId
        ? { portalPlanChangeConfigurationId: config.stripePortalPlanChangeConfigurationId }
        : {}),
    }),
    webOrigin: config.webOrigin,
  };
  const outcome = checkout
    ? kind === "checkout"
      ? await createBillingCheckoutSession({
          ...base,
          ...checkout,
          lookupKeyMap: config.billingLookupKeyMap,
        })
      : await createBillingPlanChangeSession({
          ...base,
          ...checkout,
          lookupKeyMap: config.billingLookupKeyMap,
          portalPlanChangeAvailable: Boolean(config.stripePortalPlanChangeConfigurationId),
          portalResetAvailable: Boolean(config.stripePortalResetConfigurationId),
        })
    : await createBillingPortalSession(base);
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
