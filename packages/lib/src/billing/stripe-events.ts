/** Stripeから受け付け、契約projectionの再取得契機として使うevent。 */
export const STRIPE_BILLING_EVENT_TYPES = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const;
