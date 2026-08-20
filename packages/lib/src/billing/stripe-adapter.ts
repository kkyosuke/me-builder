import Stripe from "stripe";
import type {
  BillingCheckoutSession,
  BillingCustomer,
  BillingProvider,
  BillingProviderErrorKind,
  BillingSubscription,
  BillingSubscriptionStatus,
} from "./provider";
import { BillingProviderError } from "./provider";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export function createStripeBillingProvider(input: {
  secretKey: string;
  portalConfigurationId?: string;
  portalPlanChangeConfigurationId?: string;
  portalResetConfigurationId?: string;
  timeoutMs?: number;
  maxNetworkRetries?: number;
}): BillingProvider {
  const stripe = new Stripe(input.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    timeout: input.timeoutMs ?? 10_000,
    maxNetworkRetries: input.maxNetworkRetries ?? 2,
    telemetry: false,
  });
  return new StripeBillingProvider(stripe, {
    ...(input.portalConfigurationId ? { portalConfigurationId: input.portalConfigurationId } : {}),
    ...(input.portalResetConfigurationId
      ? { portalResetConfigurationId: input.portalResetConfigurationId }
      : {}),
    ...(input.portalPlanChangeConfigurationId
      ? { portalPlanChangeConfigurationId: input.portalPlanChangeConfigurationId }
      : {}),
  });
}

export class StripeBillingProvider implements BillingProvider {
  constructor(
    private readonly stripe: Stripe,
    private readonly options: {
      portalConfigurationId?: string;
      portalPlanChangeConfigurationId?: string;
      portalResetConfigurationId?: string;
    } = {},
  ) {}

  async createCustomer(input: { accountId: string }, idempotencyKey: string) {
    return this.call(async () => {
      const customer = await this.stripe.customers.create(
        { metadata: { account_id: input.accountId } },
        { idempotencyKey },
      );
      return { id: customer.id, deleted: false };
    });
  }

  async deleteCustomer(customerId: string, idempotencyKey: string): Promise<BillingCustomer> {
    return this.call(async () => {
      const customer = await this.stripe.customers.del(customerId, { idempotencyKey });
      return { id: customer.id, deleted: customer.deleted === true };
    });
  }

  async createCheckoutSession(
    input: {
      customerId: string;
      priceId: string;
      successUrl: string;
      cancelUrl: string;
      accountId: string;
      plan: "lite" | "full" | "family";
      interval: "month" | "year";
      trialPeriodDays?: number;
    },
    idempotencyKey: string,
  ) {
    return this.call(async () => {
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: input.customerId,
          line_items: [{ price: input.priceId, quantity: 1 }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          client_reference_id: input.accountId,
          metadata: { plan: input.plan, interval: input.interval },
          ...(input.trialPeriodDays
            ? { subscription_data: { trial_period_days: input.trialPeriodDays } }
            : {}),
        },
        { idempotencyKey },
      );
      if (!session.url) throw new BillingProviderError("provider", false);
      return { id: session.id, url: session.url };
    });
  }

  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
    planChange?: {
      subscriptionId: string;
      itemId: string;
      targetPriceId: string;
      billingCycleAnchor: "unchanged" | "now";
    };
  }) {
    return this.call(async () => {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
        ...(input.planChange?.billingCycleAnchor === "now"
          ? this.options.portalResetConfigurationId
            ? { configuration: this.options.portalResetConfigurationId }
            : {}
          : input.planChange && this.options.portalPlanChangeConfigurationId
            ? { configuration: this.options.portalPlanChangeConfigurationId }
            : this.options.portalConfigurationId
              ? { configuration: this.options.portalConfigurationId }
              : {}),
        ...(input.planChange
          ? {
              flow_data: {
                type: "subscription_update_confirm" as const,
                subscription_update_confirm: {
                  subscription: input.planChange.subscriptionId,
                  items: [
                    {
                      id: input.planChange.itemId,
                      price: input.planChange.targetPriceId,
                      quantity: 1,
                    },
                  ],
                },
                after_completion: {
                  type: "redirect" as const,
                  redirect: { return_url: input.returnUrl },
                },
              },
            }
          : {}),
      });
      return { url: session.url };
    });
  }

  async scheduleSubscriptionChange(
    input: {
      subscriptionId: string;
      existingScheduleId?: string;
      currentPriceId: string;
      currentTrialEnd?: string;
      targetPriceId: string;
      targetInterval: "month" | "year";
    },
    idempotencyKey: string,
  ): Promise<{ effectiveAt: string }> {
    return this.call(async () => {
      const schedule = input.existingScheduleId
        ? await this.stripe.subscriptionSchedules.retrieve(input.existingScheduleId)
        : await this.stripe.subscriptionSchedules.create(
            { from_subscription: input.subscriptionId },
            { idempotencyKey },
          );
      if (!schedule.current_phase) throw new BillingProviderError("provider", false);
      const effectiveAt = schedule.current_phase.end_date;
      await this.stripe.subscriptionSchedules.update(
        schedule.id,
        {
          end_behavior: "release",
          proration_behavior: "none",
          phases: [
            {
              start_date: schedule.current_phase.start_date,
              end_date: effectiveAt,
              items: [{ price: input.currentPriceId, quantity: 1 }],
              proration_behavior: "none",
              ...(input.currentTrialEnd ? { trial_end: toUnixSeconds(input.currentTrialEnd) } : {}),
            },
            {
              start_date: effectiveAt,
              duration: { interval: input.targetInterval, interval_count: 1 },
              items: [{ price: input.targetPriceId, quantity: 1 }],
              proration_behavior: "none",
            },
          ],
        },
        { idempotencyKey: `${idempotencyKey}-phases` },
      );
      return { effectiveAt: fromUnixSeconds(effectiveAt) };
    });
  }

  async findPriceIdByLookupKey(lookupKey: string): Promise<string | null> {
    return this.call(async () => {
      const prices = await this.stripe.prices.list({
        lookup_keys: [lookupKey],
        active: true,
        limit: 2,
      });
      if (prices.data.length > 1) throw new BillingProviderError("provider", false);
      return prices.data[0]?.id ?? null;
    });
  }

  async findLatestCheckoutSession(customerId: string): Promise<BillingCheckoutSession | null> {
    return this.call(async () => {
      const sessions = await this.stripe.checkout.sessions.list({
        customer: customerId,
        limit: 1,
      });
      const session = sessions.data[0];
      return session ? mapCheckoutSession(session) : null;
    });
  }

  async retrieveCheckoutSession(sessionId: string): Promise<BillingCheckoutSession> {
    return this.call(async () =>
      mapCheckoutSession(await this.stripe.checkout.sessions.retrieve(sessionId)),
    );
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    await this.call(async () => {
      await this.stripe.checkout.sessions.expire(sessionId);
    });
  }

  async retrieveCustomer(customerId: string): Promise<BillingCustomer> {
    return this.call(async () => {
      const customer = await this.stripe.customers.retrieve(customerId);
      return { id: customer.id, deleted: customer.deleted === true };
    });
  }

  async retrieveSubscription(subscriptionId: string): Promise<BillingSubscription> {
    return this.call(async () =>
      mapSubscription(await this.stripe.subscriptions.retrieve(subscriptionId)),
    );
  }

  async listSubscriptions(customerId: string): Promise<readonly BillingSubscription[]> {
    return this.call(async () => {
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });
      return subscriptions.data.map(mapSubscription);
    });
  }

  constructWebhookEvent(rawBody: string, signature: string, webhookSecret: string) {
    try {
      const event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      const object = event.data.object as { id?: unknown };
      if (typeof object.id !== "string") throw new BillingProviderError("invalid-request", false);
      return {
        id: event.id,
        type: event.type,
        objectId: object.id,
        objectType:
          typeof (object as { object?: unknown }).object === "string"
            ? (object as { object: string }).object
            : "unknown",
        customerId: stripeId((object as { customer?: unknown }).customer),
        subscriptionId:
          (object as { object?: unknown }).object === "subscription"
            ? object.id
            : (stripeId((object as { subscription?: unknown }).subscription) ??
              stripeId(
                (
                  object as {
                    parent?: { subscription_details?: { subscription?: unknown } };
                  }
                ).parent?.subscription_details?.subscription,
              )),
        createdAt: fromUnixSeconds(event.created),
      };
    } catch (error) {
      throw classifyStripeError(error);
    }
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw classifyStripeError(error);
    }
  }
}

function stripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function mapCheckoutSession(session: Stripe.Checkout.Session): BillingCheckoutSession {
  const customerId = stripeId(session.customer);
  if (!customerId || !session.status) throw new BillingProviderError("provider", false);
  const plan = session.metadata?.plan;
  const interval = session.metadata?.interval;
  return {
    id: session.id,
    customerId,
    status: session.status,
    url: session.url,
    plan: plan === "lite" || plan === "full" || plan === "family" ? plan : null,
    interval: interval === "month" || interval === "year" ? interval : null,
  };
}

function mapSubscription(subscription: Stripe.Subscription): BillingSubscription {
  const item = subscription.items.data[0];
  const interval = item?.price.recurring?.interval;
  const billingInterval: "month" | "year" | null =
    interval === "month" ? "month" : interval === "year" ? "year" : null;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  return {
    id: subscription.id,
    itemId: item?.id ?? null,
    scheduleId: stripeId(subscription.schedule),
    customerId,
    status: billingSubscriptionStatus(subscription.status),
    priceId: item?.price.id ?? null,
    interval: billingInterval,
    currentPeriodStart: item ? fromUnixSeconds(item.current_period_start) : null,
    currentPeriodEnd: item ? fromUnixSeconds(item.current_period_end) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEnd: subscription.trial_end ? fromUnixSeconds(subscription.trial_end) : null,
    createdAt: fromUnixSeconds(subscription.created),
  };
}

function billingSubscriptionStatus(status: string): BillingSubscriptionStatus {
  switch (status) {
    case "incomplete":
    case "incomplete_expired":
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "unpaid":
    case "paused":
      return status;
    default:
      // Stripeがstatusを追加しても、既存の有料projectionを維持せず非権限状態へ閉じる。
      return "incomplete";
  }
}

function fromUnixSeconds(value: number): string {
  return new Date(value * 1_000).toISOString();
}

function toUnixSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new BillingProviderError("provider", false);
  return Math.floor(milliseconds / 1_000);
}

export function classifyStripeError(error: unknown): BillingProviderError {
  if (error instanceof BillingProviderError) return error;
  const stripeError = error as { type?: unknown; statusCode?: unknown; code?: unknown };
  const type = typeof stripeError?.type === "string" ? stripeError.type : "";
  const status = typeof stripeError?.statusCode === "number" ? stripeError.statusCode : undefined;
  const code = typeof stripeError?.code === "string" ? stripeError.code : "";

  let kind: BillingProviderErrorKind = "unknown";
  let retryable = false;
  if (type === "StripeConnectionError") {
    kind = code === "ETIMEDOUT" ? "timeout" : "network";
    retryable = true;
  } else if (type === "StripeRateLimitError") {
    kind = "rate-limited";
    retryable = true;
  } else if (type === "StripeAuthenticationError") kind = "authentication";
  else if (type === "StripePermissionError") kind = "permission";
  else if (type === "StripeInvalidRequestError") kind = "invalid-request";
  else if (type === "StripeIdempotencyError") kind = "idempotency-conflict";
  else if (type === "StripeSignatureVerificationError") kind = "invalid-signature";
  else if (type === "StripeAPIError") {
    kind = "provider";
    retryable = status === undefined || status >= 500;
  }
  return new BillingProviderError(kind, retryable, status, { cause: error });
}
