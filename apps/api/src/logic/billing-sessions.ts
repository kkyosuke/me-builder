import { D1, billing } from "@me-builder/lib";
import { BILLING_INITIAL_TRIAL_DAYS } from "@me-builder/shared";
import { createLiffSession } from "./liff-session";

type BaseParams = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  provider: billing.BillingProvider;
  webOrigin: string;
  createSession?: typeof createLiffSession;
};

type AuthParams = Pick<
  BaseParams,
  "idToken" | "lineLoginChannelId" | "db" | "provider" | "createSession"
>;

type SessionFailure =
  | { type: "not-configured" | "unauthenticated" | "account-not-found" }
  | {
      type: "unavailable";
      reason:
        | "plan_unavailable"
        | "existing_subscription"
        | "family_seat_active"
        | "checkout_in_progress"
        | "customer_not_found";
    };

export type CheckoutSessionStatusResult =
  | Exclude<SessionFailure, { type: "unavailable" }>
  | { type: "not-found" }
  | { type: "found"; status: "open" | "complete" | "expired" };

export async function createBillingCheckoutSession(
  params: BaseParams & {
    plan: "lite" | "full" | "family";
    interval: "month" | "year";
    lookupKeyMap: Readonly<Record<string, string>>;
  },
): Promise<SessionFailure | { type: "created"; url: string }> {
  const session = await (params.createSession ?? createLiffSession)({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
  });
  if (session.type !== "resolved") return { type: session.type };
  const accountId = session.session.accountId;
  const lookupKey = params.lookupKeyMap[`${params.plan}.${params.interval}`];
  if (!lookupKey) return { type: "unavailable", reason: "plan_unavailable" };
  const familySeat = await D1.shared.action.familySeat.readActiveFamilySeatByMember(
    params.db,
    accountId,
  );
  if (familySeat) return { type: "unavailable", reason: "family_seat_active" };
  const existing = await D1.shared.action.billing.findBillingProjectionByAccount(
    params.db,
    accountId,
  );
  if (existing && !["canceled", "incomplete_expired"].includes(existing.status)) {
    return { type: "unavailable", reason: "existing_subscription" };
  }

  let customer = await D1.shared.action.billing.findBillingCustomerByAccount(params.db, accountId);
  if (!customer) {
    const created = await params.provider.createCustomer(
      { accountId },
      `billing-customer-${accountId}`,
    );
    customer = await D1.shared.action.billing.linkBillingCustomer(params.db, {
      accountId,
      providerCustomerId: created.id,
    });
  }
  if (!customer) throw new Error("BILLING_CUSTOMER_LINK_FAILED");
  const providerSubscriptions = await params.provider.listSubscriptions(
    customer.providerCustomerId,
  );
  if (providerSubscriptions.some((subscription) => !isTerminalSubscription(subscription.status))) {
    return { type: "unavailable", reason: "existing_subscription" };
  }
  const priceId = await params.provider.findPriceIdByLookupKey(lookupKey);
  if (!priceId) return { type: "unavailable", reason: "plan_unavailable" };
  const latestCheckout = await params.provider.findLatestCheckoutSession(
    customer.providerCustomerId,
  );
  if (latestCheckout?.status === "open") {
    if (
      latestCheckout.plan === params.plan &&
      latestCheckout.interval === params.interval &&
      latestCheckout.url
    ) {
      return { type: "created", url: latestCheckout.url };
    }
    await params.provider.expireCheckoutSession(latestCheckout.id);
  }
  const trialEligible =
    !(await D1.shared.action.billing.hasUsedBillingTrial(params.db, accountId)) &&
    !providerSubscriptions.some((subscription) => subscription.trialEnd !== null);
  const origin = new URL(params.webOrigin).origin;
  const checkout = await params.provider.createCheckoutSession(
    {
      customerId: customer.providerCustomerId,
      priceId,
      successUrl: `${origin}/profile/billing?billing=checkout-return&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: new URL("/profile/billing?billing=checkout-cancel", origin).toString(),
      accountId,
      plan: params.plan,
      interval: params.interval,
      ...(trialEligible ? { trialPeriodDays: BILLING_INITIAL_TRIAL_DAYS } : {}),
    },
    `billing-checkout-${accountId}-${latestCheckout?.id ?? "initial"}`,
  );
  return { type: "created", url: checkout.url };
}

export async function getBillingCheckoutSessionStatus(
  params: BaseParams & { checkoutSessionId: string },
): Promise<CheckoutSessionStatusResult> {
  const session = await (params.createSession ?? createLiffSession)({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
  });
  if (session.type !== "resolved") return { type: session.type };
  const customer = await D1.shared.action.billing.findBillingCustomerByAccount(
    params.db,
    session.session.accountId,
  );
  if (!customer) return { type: "not-found" };
  try {
    const checkout = await params.provider.retrieveCheckoutSession(params.checkoutSessionId);
    if (checkout.customerId !== customer.providerCustomerId) return { type: "not-found" };
    return { type: "found", status: checkout.status };
  } catch (error) {
    if (error instanceof billing.BillingProviderError && error.kind === "invalid-request") {
      return { type: "not-found" };
    }
    throw error;
  }
}

export async function getBillingTrialEligibility(
  params: AuthParams,
): Promise<
  | { type: "resolved"; eligible: boolean }
  | { type: "not-configured" | "unauthenticated" | "account-not-found" }
> {
  const session = await (params.createSession ?? createLiffSession)({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
  });
  if (session.type !== "resolved") return { type: session.type };
  const accountId = session.session.accountId;
  const usedInProjection = await D1.shared.action.billing.hasUsedBillingTrial(params.db, accountId);
  const customer = await D1.shared.action.billing.findBillingCustomerByAccount(
    params.db,
    accountId,
  );
  const providerSubscriptions = customer
    ? await params.provider.listSubscriptions(customer.providerCustomerId)
    : [];
  return {
    type: "resolved",
    eligible:
      !usedInProjection &&
      !providerSubscriptions.some(
        (subscription) =>
          subscription.trialEnd !== null || !isTerminalSubscription(subscription.status),
      ),
  };
}

function isTerminalSubscription(status: billing.BillingSubscriptionStatus): boolean {
  return status === "canceled" || status === "incomplete_expired";
}

export async function createBillingPortalSession(
  params: BaseParams,
): Promise<SessionFailure | { type: "created"; url: string }> {
  const session = await (params.createSession ?? createLiffSession)({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
  });
  if (session.type !== "resolved") return { type: session.type };
  const customer = await D1.shared.action.billing.findBillingCustomerByAccount(
    params.db,
    session.session.accountId,
  );
  if (!customer) return { type: "unavailable", reason: "customer_not_found" };
  const providerCustomer = await params.provider.retrieveCustomer(customer.providerCustomerId);
  if (providerCustomer.deleted) return { type: "unavailable", reason: "customer_not_found" };
  const origin = new URL(params.webOrigin).origin;
  const portal = await params.provider.createPortalSession({
    customerId: customer.providerCustomerId,
    returnUrl: new URL("/profile?billing=portal-return", origin).toString(),
  });
  return { type: "created", url: portal.url };
}
