import { STRIPE_API_VERSION } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
const lookupKey = process.env.STRIPE_E2E_PRICE_LOOKUP_KEY?.trim();
if (
  !secretKey ||
  !["sk_test_", "rk_test_"].some((prefix) => secretKey.startsWith(prefix)) ||
  !lookupKey
) {
  throw new Error("STRIPE_SECRET_KEY(test mode) and STRIPE_E2E_PRICE_LOOKUP_KEY are required");
}

const stripe = new Stripe(secretKey, {
  apiVersion: STRIPE_API_VERSION,
  httpClient: Stripe.createFetchHttpClient(),
  telemetry: false,
});
const initialTime = Math.floor(Date.now() / 1_000) - 60;
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: initialTime,
  name: "me-builder scheduled billing lifecycle",
});

try {
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 2 });
  if (prices.data.length !== 1) throw new Error("Sandbox price lookup key must resolve uniquely");
  const customer = await stripe.customers.create({
    test_clock: clock.id,
    metadata: { managed_by: "me-builder-e2e" },
  });
  const paymentMethod = await stripe.paymentMethods.attach("pm_card_visa", {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  });
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: prices.data[0].id }],
    trial_period_days: 14,
    metadata: { managed_by: "me-builder-e2e" },
  });
  if (subscription.status !== "trialing") throw new Error("Expected trialing subscription");

  await advanceClock(stripe, clock.id, initialTime + 15 * 24 * 60 * 60);
  const afterTrial = await stripe.subscriptions.retrieve(subscription.id);
  if (afterTrial.status !== "active") throw new Error("Expected active subscription after trial");

  await advanceClock(stripe, clock.id, initialTime + 46 * 24 * 60 * 60);
  const afterRenewal = await stripe.subscriptions.retrieve(subscription.id);
  if (afterRenewal.status !== "active")
    throw new Error("Expected active subscription after renewal");

  const canceling = await stripe.subscriptions.update(subscription.id, {
    cancel_at_period_end: true,
  });
  if (!canceling.cancel_at_period_end) throw new Error("Expected cancel-at-period-end reservation");
  logger.info(
    { scenarios: ["trial", "renewal", "cancel-at-period-end"], outcome: "succeeded" },
    "Stripe sandbox billing lifecycle completed",
  );
} finally {
  await stripe.testHelpers.testClocks.del(clock.id);
}

async function advanceClock(client: Stripe, clockId: string, frozenTime: number): Promise<void> {
  await client.testHelpers.testClocks.advance(clockId, { frozen_time: frozenTime });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await client.testHelpers.testClocks.retrieve(clockId);
    if (current.status === "ready") return;
    if (current.status === "internal_failure") throw new Error("Stripe Test Clock failed");
    await Bun.sleep(1_000);
  }
  throw new Error("Stripe Test Clock timed out");
}
