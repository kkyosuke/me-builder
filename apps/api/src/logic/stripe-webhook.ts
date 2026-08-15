import { billing } from "@me-builder/lib";
import type { BillingQueueMessage, Queue } from "@me-builder/shared";
import { logger } from "@me-builder/shared";

const ACCEPTED_STRIPE_EVENT_TYPES = new Set<string>(billing.STRIPE_BILLING_EVENT_TYPES);

export type StripeWebhookOutcome =
  | { type: "accepted"; queued: true; eventId: string }
  | { type: "ignored" }
  | { type: "invalid-signature" }
  | { type: "not-configured" };

export async function receiveStripeWebhook(input: {
  rawBody: string;
  signature: string | undefined;
  webhookSecret: string | undefined;
  provider: billing.BillingProvider | undefined;
  queue: Queue<BillingQueueMessage> | undefined;
}): Promise<StripeWebhookOutcome> {
  if (!input.webhookSecret || !input.provider || !input.queue) return { type: "not-configured" };
  if (!input.signature) return { type: "invalid-signature" };

  let event: ReturnType<billing.BillingProvider["constructWebhookEvent"]>;
  try {
    event = input.provider.constructWebhookEvent(
      input.rawBody,
      input.signature,
      input.webhookSecret,
    );
  } catch (error) {
    if (error instanceof billing.BillingProviderError && error.kind === "invalid-signature") {
      return { type: "invalid-signature" };
    }
    // malformed payloadも署名検証失敗と同じ応答にし、本文やSDK例外を記録しない。
    return { type: "invalid-signature" };
  }
  if (!ACCEPTED_STRIPE_EVENT_TYPES.has(event.type)) {
    logger.info(
      { event: "stripe.webhook.ignored", service: "api", eventType: event.type },
      "[Stripe webhook] ignored unsupported event type",
    );
    return { type: "ignored" };
  }

  const traceId = crypto.randomUUID();
  await input.queue.send({
    type: "billing-event",
    version: 1,
    traceId,
    eventId: event.id,
    eventType: event.type,
    objectId: event.objectId,
    objectType: event.objectType,
    customerId: event.customerId,
    subscriptionId: event.subscriptionId,
    createdAt: event.createdAt,
  });
  logger.info(
    {
      event: "stripe.webhook.accepted",
      service: "api",
      component: "billing",
      traceId,
      eventType: event.type,
      outcome: "succeeded",
      disposition: "queued",
    },
    "[Stripe webhook] succeeded at signature.verify -> queued",
  );
  return { type: "accepted", queued: true, eventId: event.id };
}
