export type BillingSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export type BillingCustomer = Readonly<{ id: string; deleted: boolean }>;

export type BillingSubscription = Readonly<{
  id: string;
  customerId: string;
  status: BillingSubscriptionStatus;
  priceId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
  createdAt: string;
}>;

export type BillingWebhookEvent = Readonly<{
  id: string;
  type: string;
  objectId: string;
  objectType: string;
  customerId: string | null;
  subscriptionId: string | null;
  createdAt: string;
}>;

export interface BillingProvider {
  createCustomer(input: { accountId: string }, idempotencyKey: string): Promise<BillingCustomer>;
  createCheckoutSession(
    input: {
      customerId: string;
      priceId: string;
      successUrl: string;
      cancelUrl: string;
      accountId: string;
    },
    idempotencyKey: string,
  ): Promise<{ id: string; url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  retrieveCustomer(customerId: string): Promise<BillingCustomer>;
  retrieveSubscription(subscriptionId: string): Promise<BillingSubscription>;
  listSubscriptions(customerId: string): Promise<readonly BillingSubscription[]>;
  constructWebhookEvent(
    rawBody: string,
    signature: string,
    webhookSecret: string,
  ): BillingWebhookEvent;
}

export type BillingProviderErrorKind =
  | "timeout"
  | "network"
  | "rate-limited"
  | "authentication"
  | "permission"
  | "invalid-request"
  | "idempotency-conflict"
  | "invalid-signature"
  | "provider"
  | "unknown";

/** SDKの例外本文やresponseを境界外へ持ち出さない固定エラー。 */
export class BillingProviderError extends Error {
  constructor(
    readonly kind: BillingProviderErrorKind,
    readonly retryable: boolean,
    readonly dependencyStatus?: number,
    options?: { cause?: unknown },
  ) {
    super(`BILLING_PROVIDER_${kind.toUpperCase().replaceAll("-", "_")}`, options);
    this.name = "BillingProviderError";
  }
}
