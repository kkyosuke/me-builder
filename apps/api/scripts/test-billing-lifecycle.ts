import { billing } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import Stripe from "stripe";

const { PORTAL_CONFIGURATION_VERSION, STRIPE_API_VERSION, STRIPE_BILLING_CATALOG } = billing;
const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
if (!secretKey || !["sk_test_", "rk_test_"].some((prefix) => secretKey.startsWith(prefix))) {
  throw new Error("STRIPE_SECRET_KEY must be a Stripe sandbox key");
}

const stripe = new Stripe(secretKey, {
  apiVersion: STRIPE_API_VERSION,
  httpClient: Stripe.createFetchHttpClient(),
  telemetry: false,
});
const DAY_SECONDS = 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;
// Stripe Test Clockは、そのclock上で最短の課金間隔の2倍までしか一度に進められない。
// 年額から月額への期間末変更では次phaseの月額が基準になるため、年末まで月単位で刻む。
const MAX_CLOCK_ADVANCE_SECONDS = 30 * DAY_SECONDS;
const initialTime = Math.floor(Date.now() / 1_000) - 60;
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: initialTime,
  name: "me-builder scheduled billing lifecycle",
});

try {
  await logStripeAccountReadiness(stripe);
  const [litePriceId, liteYearlyPriceId, fullPriceId, fullYearlyPriceId] = await Promise.all([
    resolvePriceId(stripe, "lite", "month"),
    resolvePriceId(stripe, "lite", "year"),
    resolvePriceId(stripe, "full", "month"),
    resolvePriceId(stripe, "full", "year"),
  ]);
  await assertCheckoutSession(stripe, litePriceId);
  const portalConfigurations = await resolvePortalConfigurations(stripe);
  const customer = await stripe.customers.create({
    test_clock: clock.id,
    metadata: { managed_by: "me-builder-e2e" },
  });
  const successfulPaymentMethod = await stripe.paymentMethods.attach("pm_card_visa", {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: successfulPaymentMethod.id },
  });
  let subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: litePriceId }],
    trial_period_days: 14,
    metadata: { managed_by: "me-builder-e2e" },
  });
  assertSubscription(subscription, { status: "trialing", priceId: litePriceId });

  await advanceClock(stripe, clock.id, initialTime + 15 * DAY_SECONDS);
  subscription = await stripe.subscriptions.retrieve(subscription.id);
  assertSubscription(subscription, { status: "active", priceId: litePriceId });

  // 最初の通常更新を成功させる。invoiceのdraft期間も進めて確定まで待つ。
  await advancePastCurrentPeriod(stripe, clock.id, subscription);
  subscription = await stripe.subscriptions.retrieve(subscription.id);
  assertSubscription(subscription, { status: "active", priceId: litePriceId });

  // hosted UIの操作前に、アプリが使うdeep linkと請求期間policyをsandbox設定で検証する。
  const sourceItemId = requiredItem(subscription).id;
  await assertPortalPlanChangeSession(stripe, {
    configurationId: portalConfigurations.standard,
    customerId: customer.id,
    subscriptionId: subscription.id,
    itemId: sourceItemId,
    targetPriceId: fullPriceId,
  });
  await assertPortalPlanChangeSession(stripe, {
    configurationId: portalConfigurations.reset,
    customerId: customer.id,
    subscriptionId: subscription.id,
    itemId: sourceItemId,
    targetPriceId: liteYearlyPriceId,
  });

  // 同じ請求間隔のupgradeは日割り差額を即時請求し、成功時だけ適用する。
  const itemId = requiredItem(subscription).id;
  subscription = await stripe.subscriptions.update(subscription.id, {
    items: [{ id: itemId, price: fullPriceId }],
    proration_behavior: "always_invoice",
    payment_behavior: "pending_if_incomplete",
  });
  assertSubscription(subscription, { status: "active", priceId: fullPriceId });

  // downgradeは現在期間の終了時にLiteへ切り替えるscheduleとして再現する。
  const schedule = await stripe.subscriptionSchedules.create({
    from_subscription: subscription.id,
  });
  if (!schedule.current_phase) throw new Error("Expected an active subscription schedule phase");
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        start_date: schedule.current_phase.start_date,
        end_date: schedule.current_phase.end_date,
        items: [{ price: fullPriceId, quantity: 1 }],
        proration_behavior: "none",
      },
      {
        start_date: schedule.current_phase.end_date,
        duration: { interval: "month", interval_count: 1 },
        items: [{ price: litePriceId, quantity: 1 }],
        proration_behavior: "none",
      },
    ],
    proration_behavior: "none",
  });
  await advanceClock(stripe, clock.id, schedule.current_phase.end_date + 2 * HOUR_SECONDS);
  subscription = await stripe.subscriptions.retrieve(subscription.id);
  assertSubscription(subscription, { status: "active", priceId: litePriceId });
  const activeSchedule = await stripe.subscriptionSchedules.retrieve(schedule.id);
  if (activeSchedule.status === "active") await stripe.subscriptionSchedules.release(schedule.id);

  // 月額から年額へのupgradeは変更日を新しい期間開始日として即時請求する。
  const annualStart = (await stripe.testHelpers.testClocks.retrieve(clock.id)).frozen_time;
  subscription = await stripe.subscriptions.update(subscription.id, {
    items: [{ id: requiredItem(subscription).id, price: fullYearlyPriceId }],
    billing_cycle_anchor: "now",
    proration_behavior: "always_invoice",
    payment_behavior: "pending_if_incomplete",
  });
  assertSubscription(subscription, { status: "active", priceId: fullYearlyPriceId });
  if (Math.abs(requiredItem(subscription).current_period_start - annualStart) > 5 * 60) {
    throw new Error("Expected annual billing period to start at plan change");
  }

  // 年額から月額への変更は現在の年額期間を維持し、期間末に適用する。
  const annualSchedule = await stripe.subscriptionSchedules.create({
    from_subscription: subscription.id,
  });
  if (!annualSchedule.current_phase) throw new Error("Expected an annual schedule phase");
  await stripe.subscriptionSchedules.update(annualSchedule.id, {
    end_behavior: "release",
    phases: [
      {
        start_date: annualSchedule.current_phase.start_date,
        end_date: annualSchedule.current_phase.end_date,
        items: [{ price: fullYearlyPriceId, quantity: 1 }],
        proration_behavior: "none",
      },
      {
        start_date: annualSchedule.current_phase.end_date,
        duration: { interval: "month", interval_count: 1 },
        items: [{ price: litePriceId, quantity: 1 }],
        proration_behavior: "none",
      },
    ],
    proration_behavior: "none",
  });
  await advanceClock(stripe, clock.id, annualSchedule.current_phase.end_date + 2 * HOUR_SECONDS);
  subscription = await stripe.subscriptions.retrieve(subscription.id);
  assertSubscription(subscription, { status: "active", priceId: litePriceId });
  const currentAnnualSchedule = await stripe.subscriptionSchedules.retrieve(annualSchedule.id);
  if (currentAnnualSchedule.status === "active") {
    await stripe.subscriptionSchedules.release(annualSchedule.id);
  }

  // Customerへattach後に失敗する公式test PaymentMethodで次回更新をpast_dueにする。
  const failingPaymentMethod = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: failingPaymentMethod.id },
  });
  await advancePastCurrentPeriod(stripe, clock.id, subscription);
  subscription = await stripe.subscriptions.retrieve(subscription.id);
  assertSubscription(subscription, { status: "past_due", priceId: litePriceId });

  // 支払方法を戻して失敗invoiceを支払うと同じSubscriptionがactiveへ回復する。
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: successfulPaymentMethod.id },
  });
  const latestInvoiceId = stripeId(subscription.latest_invoice);
  if (!latestInvoiceId) throw new Error("Expected a failed renewal invoice");
  await stripe.invoices.pay(latestInvoiceId, { payment_method: successfulPaymentMethod.id });
  subscription = await stripe.subscriptions.retrieve(subscription.id);
  assertSubscription(subscription, { status: "active", priceId: litePriceId });

  // 期間末解約は取消可能で、再予約後の期間末にcanceledへ遷移する。
  subscription = await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
  if (!subscription.cancel_at_period_end) throw new Error("Expected cancellation reservation");
  subscription = await stripe.subscriptions.update(subscription.id, {
    cancel_at_period_end: false,
  });
  if (subscription.cancel_at_period_end) throw new Error("Expected subscription resume");
  subscription = await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
  await advancePastCurrentPeriod(stripe, clock.id, subscription);
  subscription = await stripe.subscriptions.retrieve(subscription.id);
  if (subscription.status !== "canceled") throw new Error("Expected canceled subscription");

  logger.info(
    {
      scenarios: [
        "checkout-session",
        "trial",
        "renewal",
        "upgrade",
        "downgrade-at-period-end",
        "portal-plan-change-deep-links",
        "monthly-to-yearly-reset",
        "yearly-to-monthly-at-period-end",
        "payment-failure",
        "payment-recovery",
        "cancel-resume-cancel",
      ],
      outcome: "succeeded",
    },
    "Stripe sandbox billing lifecycle completed",
  );
} finally {
  await stripe.testHelpers.testClocks.del(clock.id);
}

async function logStripeAccountReadiness(client: Stripe): Promise<void> {
  const account = await client.accounts.retrieveCurrent();
  const readiness = {
    businessProfileNameConfigured: Boolean(account.business_profile?.name),
    statementDescriptorConfigured: Boolean(account.settings?.payments?.statement_descriptor),
    chargesEnabled: account.charges_enabled,
    detailsSubmitted: account.details_submitted,
    cardPaymentsCapability: account.capabilities?.card_payments ?? "unknown",
  };
  const ready =
    readiness.businessProfileNameConfigured &&
    readiness.statementDescriptorConfigured &&
    readiness.chargesEnabled;
  const fields = {
    event: ready
      ? "stripe.sandbox.account-configuration.completed"
      : "stripe.sandbox.account-configuration.failed",
    service: "api",
    outcome: ready ? "succeeded" : "failed",
    ...(ready ? {} : { errorCode: "STRIPE_SANDBOX_ACCOUNT_CONFIGURATION_INCOMPLETE" }),
    ...readiness,
  };
  if (ready) logger.info(fields, "Stripe sandbox account configuration is ready");
  else logger.error(fields, "Stripe sandbox account configuration is incomplete");
}

async function assertCheckoutSession(client: Stripe, priceId: string): Promise<void> {
  let customerId: string | undefined;
  try {
    const customer = await client.customers.create({
      metadata: { managed_by: "me-builder-e2e", purpose: "checkout-smoke" },
    });
    customerId = customer.id;
    const session = await client.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_collection: "always",
      success_url:
        "https://stg.kagami.kyosuke.dev/profile/billing?billing=checkout-return&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://stg.kagami.kyosuke.dev/profile/billing?billing=checkout-cancel",
      client_reference_id: "me-builder-checkout-smoke",
      metadata: { plan: "lite", interval: "month", managed_by: "me-builder-e2e" },
      subscription_data: { trial_period_days: 14 },
    });
    if (!session.url) throw new Error("Checkout Session URL was missing");
    if (session.payment_method_collection !== "always") {
      throw new Error("Checkout Session did not require a payment method");
    }
    await client.checkout.sessions.expire(session.id);
    logger.info(
      {
        event: "stripe.sandbox.checkout.completed",
        service: "api",
        outcome: "succeeded",
      },
      "Stripe sandbox Checkout Session creation succeeded",
    );
  } catch (error) {
    const stripeError = safeStripeErrorFields(error);
    logger.error(
      {
        event: "stripe.sandbox.checkout.failed",
        service: "api",
        outcome: "failed",
        errorCode: "STRIPE_SANDBOX_CHECKOUT_FAILED",
        ...stripeError,
      },
      "Stripe sandbox Checkout Session creation failed",
    );
    // Stripe SDK例外のmessage/cause/responseはCIログへ出さない。
    throw new Error("STRIPE_SANDBOX_CHECKOUT_FAILED");
  } finally {
    if (customerId) {
      try {
        await client.customers.del(customerId);
      } catch {
        logger.warn(
          {
            event: "stripe.sandbox.checkout.cleanup.degraded",
            service: "api",
            outcome: "degraded",
            errorCode: "STRIPE_SANDBOX_CHECKOUT_CUSTOMER_CLEANUP_FAILED",
          },
          "Stripe sandbox Checkout smoke customer cleanup failed",
        );
      }
    }
  }
}

function safeStripeErrorFields(error: unknown): Record<string, string | number> {
  const candidate = error as {
    type?: unknown;
    code?: unknown;
    param?: unknown;
    statusCode?: unknown;
    requestId?: unknown;
    raw?: { type?: unknown; code?: unknown; param?: unknown; requestId?: unknown };
  };
  const safeToken = (value: unknown, pattern: RegExp): string | undefined =>
    typeof value === "string" && pattern.test(value) ? value : undefined;
  const stripeErrorType = safeToken(
    candidate?.type ?? candidate?.raw?.type,
    /^[A-Za-z][A-Za-z0-9_]{0,79}$/u,
  );
  const stripeErrorCode = safeToken(
    candidate?.code ?? candidate?.raw?.code,
    /^[a-z][a-z0-9_]{0,79}$/u,
  );
  const stripeErrorParam = safeToken(
    candidate?.param ?? candidate?.raw?.param,
    /^[A-Za-z0-9_.[\]-]{1,120}$/u,
  );
  const dependencyRequestId = safeToken(
    candidate?.requestId ?? candidate?.raw?.requestId,
    /^req_[A-Za-z0-9]{1,80}$/u,
  );
  return {
    ...(stripeErrorType ? { stripeErrorType } : {}),
    ...(stripeErrorCode ? { stripeErrorCode } : {}),
    ...(stripeErrorParam ? { stripeErrorParam } : {}),
    ...(typeof candidate?.statusCode === "number"
      ? { dependencyStatus: candidate.statusCode }
      : {}),
    ...(dependencyRequestId ? { dependencyRequestId } : {}),
  };
}

async function resolvePriceId(
  client: Stripe,
  plan: "lite" | "full",
  interval: "month" | "year",
): Promise<string> {
  const desired = STRIPE_BILLING_CATALOG.flatMap((item) => item.prices).find(
    (price) => price.plan === plan && price.interval === interval,
  );
  if (!desired) throw new Error(`Missing ${plan} ${interval} catalog entry`);
  const prices = await client.prices.list({
    lookup_keys: [desired.lookupKey],
    active: true,
    limit: 2,
  });
  if (prices.data.length !== 1) {
    throw new Error(`Sandbox lookup key for ${plan} ${interval} price must resolve uniquely`);
  }
  const price = prices.data[0];
  if (!price) throw new Error(`Missing ${plan} ${interval} price`);
  return price.id;
}

async function resolvePortalConfigurations(client: Stripe): Promise<{
  standard: string;
  reset: string;
}> {
  const configurations = await client.billingPortal.configurations.list({ limit: 100 });
  const managed = configurations.data.filter(
    (configuration) =>
      configuration.active &&
      configuration.metadata?.managed_by === "me-builder-stripe-catalog" &&
      configuration.metadata?.portal_configuration_version === PORTAL_CONFIGURATION_VERSION,
  );
  const management = managed.find(
    (configuration) => configuration.metadata?.portal_mode === "management",
  );
  const standard = managed.find(
    (configuration) => configuration.metadata?.portal_mode === "standard",
  );
  const reset = managed.find((configuration) => configuration.metadata?.portal_mode === "reset");
  if (!management || !standard || !reset) {
    throw new Error("Expected management, standard, and reset Portal configurations");
  }
  if (management.features.subscription_update.enabled) {
    throw new Error("Management Portal must not allow plan changes");
  }
  if (standard.features.subscription_update.billing_cycle_anchor !== "unchanged") {
    throw new Error("Standard Portal must preserve the billing cycle");
  }
  if (standard.features.subscription_update.schedule_at_period_end.conditions.length !== 0) {
    throw new Error("Standard Portal must leave period-end changes to the API schedule path");
  }
  if (reset.features.subscription_update.billing_cycle_anchor !== "now") {
    throw new Error("Reset Portal must start a new billing cycle");
  }
  if (reset.features.subscription_update.schedule_at_period_end.conditions.length !== 0) {
    throw new Error("Reset Portal must not schedule monthly-to-yearly changes at period end");
  }
  return { standard: standard.id, reset: reset.id };
}

async function assertPortalPlanChangeSession(
  client: Stripe,
  input: {
    configurationId: string;
    customerId: string;
    subscriptionId: string;
    itemId: string;
    targetPriceId: string;
  },
): Promise<void> {
  const session = await client.billingPortal.sessions.create({
    customer: input.customerId,
    configuration: input.configurationId,
    return_url: "https://example.test/profile/billing",
    flow_data: {
      type: "subscription_update_confirm",
      subscription_update_confirm: {
        subscription: input.subscriptionId,
        items: [{ id: input.itemId, price: input.targetPriceId, quantity: 1 }],
      },
      after_completion: {
        type: "redirect",
        redirect: { return_url: "https://example.test/profile/billing" },
      },
    },
  });
  if (session.configuration !== input.configurationId) {
    throw new Error("Portal session used an unexpected configuration");
  }
  if (session.flow?.type !== "subscription_update_confirm") {
    throw new Error("Portal session did not create a plan change confirmation flow");
  }
}

async function advancePastCurrentPeriod(
  client: Stripe,
  clockId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  await advanceClock(
    client,
    clockId,
    requiredItem(subscription).current_period_end + 2 * HOUR_SECONDS,
  );
}

function requiredItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem {
  const item = subscription.items.data[0];
  if (!item) throw new Error("Expected one subscription item");
  return item;
}

function assertSubscription(
  subscription: Stripe.Subscription,
  expected: { status: Stripe.Subscription.Status; priceId: string },
): void {
  if (subscription.status !== expected.status) {
    throw new Error(`Expected subscription status ${expected.status}, got ${subscription.status}`);
  }
  const priceId = requiredItem(subscription).price.id;
  if (priceId !== expected.priceId) throw new Error("Unexpected subscription price");
}

function stripeId(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

async function advanceClock(client: Stripe, clockId: string, frozenTime: number): Promise<void> {
  let currentFrozenTime = (await client.testHelpers.testClocks.retrieve(clockId)).frozen_time;
  while (currentFrozenTime < frozenTime) {
    const nextFrozenTime = Math.min(frozenTime, currentFrozenTime + MAX_CLOCK_ADVANCE_SECONDS);
    await client.testHelpers.testClocks.advance(clockId, { frozen_time: nextFrozenTime });
    currentFrozenTime = (await waitForClock(client, clockId)).frozen_time;
  }
}

async function waitForClock(
  client: Stripe,
  clockId: string,
): Promise<Stripe.TestHelpers.TestClock> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = await client.testHelpers.testClocks.retrieve(clockId);
    if (current.status === "ready") return current;
    if (current.status === "internal_failure") throw new Error("Stripe Test Clock failed");
    await Bun.sleep(1_000);
  }
  throw new Error("Stripe Test Clock timed out");
}
