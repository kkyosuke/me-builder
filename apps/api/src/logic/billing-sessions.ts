import { D1, type billing } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type BaseParams = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  provider: billing.BillingProvider;
  webOrigin: string;
  createSession?: typeof createLiffSession;
};

type SessionFailure =
  | { type: "not-configured" | "unauthenticated" | "account-not-found" }
  | {
      type: "unavailable";
      reason: "plan_unavailable" | "existing_subscription" | "checkout_in_progress";
    };

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
  if (await params.provider.hasOpenCheckoutSession(customer.providerCustomerId)) {
    return { type: "unavailable", reason: "checkout_in_progress" };
  }
  const priceId = await params.provider.findPriceIdByLookupKey(lookupKey);
  if (!priceId) return { type: "unavailable", reason: "plan_unavailable" };
  const origin = new URL(params.webOrigin).origin;
  const checkout = await params.provider.createCheckoutSession(
    {
      customerId: customer.providerCustomerId,
      priceId,
      successUrl: new URL("/profile?billing=checkout-return", origin).toString(),
      cancelUrl: new URL("/profile?billing=checkout-cancel", origin).toString(),
      accountId,
    },
    `billing-checkout-${accountId}`,
  );
  return { type: "created", url: checkout.url };
}
