import type {
  BillingCustomer,
  BillingProvider,
  BillingSubscription,
  BillingWebhookEvent,
} from "./provider";

type Handlers = Partial<{
  createCustomer: BillingProvider["createCustomer"];
  createCheckoutSession: BillingProvider["createCheckoutSession"];
  createPortalSession: BillingProvider["createPortalSession"];
  findPriceIdByLookupKey: BillingProvider["findPriceIdByLookupKey"];
  hasOpenCheckoutSession: BillingProvider["hasOpenCheckoutSession"];
  retrieveCustomer: BillingProvider["retrieveCustomer"];
  retrieveSubscription: BillingProvider["retrieveSubscription"];
  listSubscriptions: BillingProvider["listSubscriptions"];
  constructWebhookEvent: BillingProvider["constructWebhookEvent"];
}>;

export class FakeBillingProvider implements BillingProvider {
  constructor(private readonly handlers: Handlers = {}) {}

  async createCustomer(input: { accountId: string }, key: string): Promise<BillingCustomer> {
    if (this.handlers.createCustomer) return this.handlers.createCustomer(input, key);
    return { id: `cus_${input.accountId}`, deleted: false };
  }

  async createCheckoutSession(
    input: {
      customerId: string;
      priceId: string;
      successUrl: string;
      cancelUrl: string;
      accountId: string;
    },
    key: string,
  ): Promise<{ id: string; url: string }> {
    if (this.handlers.createCheckoutSession) return this.handlers.createCheckoutSession(input, key);
    return { id: "cs_test", url: input.successUrl };
  }

  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    if (this.handlers.createPortalSession) return this.handlers.createPortalSession(input);
    return { url: input.returnUrl };
  }

  async findPriceIdByLookupKey(lookupKey: string): Promise<string | null> {
    if (this.handlers.findPriceIdByLookupKey)
      return this.handlers.findPriceIdByLookupKey(lookupKey);
    return `price_${lookupKey}`;
  }

  async hasOpenCheckoutSession(customerId: string): Promise<boolean> {
    if (this.handlers.hasOpenCheckoutSession)
      return this.handlers.hasOpenCheckoutSession(customerId);
    return false;
  }

  async retrieveCustomer(customerId: string): Promise<BillingCustomer> {
    if (this.handlers.retrieveCustomer) return this.handlers.retrieveCustomer(customerId);
    return { id: customerId, deleted: false };
  }

  async retrieveSubscription(subscriptionId: string): Promise<BillingSubscription> {
    if (this.handlers.retrieveSubscription)
      return this.handlers.retrieveSubscription(subscriptionId);
    throw new Error("Fake retrieveSubscription handler is not configured");
  }

  async listSubscriptions(customerId: string): Promise<readonly BillingSubscription[]> {
    if (this.handlers.listSubscriptions) return this.handlers.listSubscriptions(customerId);
    return [];
  }

  constructWebhookEvent(rawBody: string, signature: string, secret: string): BillingWebhookEvent {
    if (this.handlers.constructWebhookEvent)
      return this.handlers.constructWebhookEvent(rawBody, signature, secret);
    throw new Error("Fake constructWebhookEvent handler is not configured");
  }
}
