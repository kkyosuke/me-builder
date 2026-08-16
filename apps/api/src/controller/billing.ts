import { billing } from "@me-builder/lib";
import type { Context } from "hono";
import { getConfig } from "../config";
import { receiveStripeWebhook } from "../logic/stripe-webhook";
import type { AppEnv } from "../types";

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
